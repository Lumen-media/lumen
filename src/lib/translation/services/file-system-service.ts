import { readTextFile, writeTextFile, exists, readDir, remove } from "@tauri-apps/plugin-fs";
import type { FileSystemService, TranslationFile } from "../types";
import { TRANSLATION_PATHS, LANGUAGE_CODE_PATTERN } from "../constants";
import {
	createFileSystemError,
	FileSystemErrorCode,
	createValidationError,
	ValidationErrorCode,
	FileSystemError,
} from "../errors";

export class TauriFileSystemService implements FileSystemService {
	private readonly localesDir = TRANSLATION_PATHS.LOCALES_DIR;
	private readonly translationFile = TRANSLATION_PATHS.TRANSLATION_FILE;
	private readonly backupSuffix = TRANSLATION_PATHS.BACKUP_SUFFIX;
	private readonly tempSuffix = TRANSLATION_PATHS.TEMP_SUFFIX;

	async readTranslationFile(language: string): Promise<Record<string, string>> {
		this.validateLanguageCode(language);

		const filePath = this.getTranslationFilePath(language);

		try {
			const fileExists = await exists(filePath);
			if (!fileExists) {
				throw createFileSystemError(
					FileSystemErrorCode.FILE_NOT_FOUND,
					`Translation file not found: ${filePath}`
				);
			}

			const content = await readTextFile(filePath);

			const translations = JSON.parse(content) as TranslationFile;

			return this.flattenTranslations(translations);
		} catch (error) {
			if (error instanceof SyntaxError) {
				throw createFileSystemError(
					FileSystemErrorCode.CORRUPTION_DETECTED,
					`Invalid JSON in translation file: ${filePath}`,
					error
				);
			}

			if ((error as Error).message?.includes("permission")) {
				throw createFileSystemError(
					FileSystemErrorCode.PERMISSION_DENIED,
					`Permission denied reading file: ${filePath}`,
					error as Error
				);
			}

			throw createFileSystemError(
				FileSystemErrorCode.READ_FAILED,
				`Failed to read translation file: ${filePath}`,
				error as Error
			);
		}
	}

	async writeTranslationFile(
		language: string,
		translations: Record<string, string>
	): Promise<void> {
		this.validateLanguageCode(language);

		const filePath = this.getTranslationFilePath(language);
		const tempPath = `${filePath}${this.tempSuffix}`;

		try {
			await this.ensureLanguageDirectory(language);

			await this.backupTranslationFile(language);

			const nestedTranslations = this.unflattenTranslations(translations);

			const content = JSON.stringify(nestedTranslations, null, "\t");
			await writeTextFile(tempPath, content);

			const verifyContent = await readTextFile(tempPath);
			JSON.parse(verifyContent);

			await this.moveFile(tempPath, filePath);
		} catch (error) {
			try {
				const tempExists = await exists(tempPath);
				if (tempExists) {
					await this.deleteFile(tempPath);
				}
			} catch {}

			if ((error as Error).message?.includes("permission")) {
				throw createFileSystemError(
					FileSystemErrorCode.PERMISSION_DENIED,
					`Permission denied writing file: ${filePath}`,
					error as Error
				);
			}

			if ((error as Error).message?.includes("space")) {
				throw createFileSystemError(
					FileSystemErrorCode.DISK_FULL,
					`Insufficient disk space for file: ${filePath}`,
					error as Error
				);
			}

			throw createFileSystemError(
				FileSystemErrorCode.WRITE_FAILED,
				`Failed to write translation file: ${filePath}`,
				error as Error
			);
		}
	}

	async backupTranslationFile(language: string): Promise<void> {
		this.validateLanguageCode(language);

		const filePath = this.getTranslationFilePath(language);
		const backupPath = `${filePath}${this.backupSuffix}`;

		try {
			const fileExists = await exists(filePath);
			if (!fileExists) {
				return;
			}

			const content = await readTextFile(filePath);
			await writeTextFile(backupPath, content);
		} catch (error) {
			throw createFileSystemError(
				FileSystemErrorCode.BACKUP_FAILED,
				`Failed to create backup for: ${filePath}`,
				error as Error
			);
		}
	}

	async restoreTranslationFile(language: string): Promise<void> {
		this.validateLanguageCode(language);

		const filePath = this.getTranslationFilePath(language);
		const backupPath = `${filePath}${this.backupSuffix}`;

		try {
			const backupExists = await exists(backupPath);
			if (!backupExists) {
				throw createFileSystemError(
					FileSystemErrorCode.FILE_NOT_FOUND,
					`Backup file not found: ${backupPath}`
				);
			}

			const content = await readTextFile(backupPath);
			await writeTextFile(filePath, content);
		} catch (error) {
			throw createFileSystemError(
				FileSystemErrorCode.RESTORE_FAILED,
				`Failed to restore from backup: ${backupPath}`,
				error as Error
			);
		}
	}

	async ensureTranslationDirectory(): Promise<void> {
		try {
			const dirExists = await exists(this.localesDir);
			if (!dirExists) {
				const tempFile = `${this.localesDir}/.temp`;
				await writeTextFile(tempFile, "temp");
				await remove(tempFile);
			}
		} catch (error) {
			throw createFileSystemError(
				FileSystemErrorCode.DIRECTORY_CREATION_FAILED,
				`Failed to create translation directory: ${this.localesDir}`,
				error as Error
			);
		}
	}

	async createLanguageDirectory(languageCode: string): Promise<void> {
		this.validateLanguageCode(languageCode);

		const languageDir = this.getLanguageDir(languageCode);

		try {
			await this.ensureTranslationDirectory();

			const dirExists = await exists(languageDir);
			if (!dirExists) {
				const tempFile = `${languageDir}/.temp`;
				await writeTextFile(tempFile, "temp");
				await remove(tempFile);
			}
		} catch (error) {
			throw createFileSystemError(
				FileSystemErrorCode.DIRECTORY_CREATION_FAILED,
				`Failed to create language directory: ${languageDir}`,
				error as Error
			);
		}
	}

	async getAvailableLanguages(): Promise<string[]> {
		try {
			await this.ensureTranslationDirectory();

			const dirExists = await exists(this.localesDir);
			if (!dirExists) {
				return [];
			}

			const entries = await readDir(this.localesDir);
			const languages: string[] = [];

			for (const entry of entries) {
				if (entry.isDirectory && entry.name) {
					if (LANGUAGE_CODE_PATTERN.test(entry.name)) {
						const translationPath = this.getTranslationFilePath(entry.name);
						const translationExists = await exists(translationPath);

						if (translationExists) {
							languages.push(entry.name);
						}
					}
				}
			}

			return languages.sort();
		} catch (error) {
			throw createFileSystemError(
				FileSystemErrorCode.READ_FAILED,
				`Failed to read available languages from: ${this.localesDir}`,
				error as Error
			);
		}
	}

	async copyTranslationStructure(sourceLanguage: string, targetLanguage: string): Promise<void> {
		this.validateLanguageCode(sourceLanguage);
		this.validateLanguageCode(targetLanguage);

		if (sourceLanguage === targetLanguage) {
			throw createValidationError(
				ValidationErrorCode.INVALID_LANGUAGE_CODE,
				"Source and target languages cannot be the same"
			);
		}

		try {
			const sourceTranslations = await this.readTranslationFile(sourceLanguage);
			await this.createLanguageDirectory(targetLanguage);
			await this.writeTranslationFile(targetLanguage, sourceTranslations);
		} catch (error) {
			if (error instanceof FileSystemError && error.code === FileSystemErrorCode.FILE_NOT_FOUND) {
				throw createFileSystemError(
					FileSystemErrorCode.FILE_NOT_FOUND,
					`Source language file not found: ${sourceLanguage}`
				);
			}
			throw error;
		}
	}

	// ============================================================================
	// Private Helper Methods
	// ============================================================================

	private validateLanguageCode(language: string): void {
		if (!language || typeof language !== "string") {
			throw createValidationError(
				ValidationErrorCode.INVALID_LANGUAGE_CODE,
				"Language code must be a non-empty string"
			);
		}

		if (!LANGUAGE_CODE_PATTERN.test(language)) {
			throw createValidationError(
				ValidationErrorCode.INVALID_LANGUAGE_CODE,
				`Invalid language code format: ${language}. Expected format: 'en' or 'en-US'`
			);
		}
	}

	private getLanguageDir(language: string): string {
		return `${this.localesDir}/${language}`;
	}

	private getTranslationFilePath(language: string): string {
		return `${this.getLanguageDir(language)}/${this.translationFile}`;
	}

	private flattenTranslations(
		obj: TranslationFile,
		prefix = "",
		result: Record<string, string> = {}
	): Record<string, string> {
		for (const [key, value] of Object.entries(obj)) {
			const newKey = prefix ? `${prefix}.${key}` : key;

			if (typeof value === "string") {
				result[newKey] = value;
			} else if (typeof value === "object" && value !== null) {
				this.flattenTranslations(value, newKey, result);
			}
		}

		return result;
	}

	private unflattenTranslations(flat: Record<string, string>): TranslationFile {
		const result: TranslationFile = {};

		for (const [key, value] of Object.entries(flat)) {
			const keys = key.split(".");
			let current = result;

			for (let i = 0; i < keys.length - 1; i++) {
				const k = keys[i];
				if (!(k in current)) {
					current[k] = {};
				}
				current = current[k] as TranslationFile;
			}

			current[keys[keys.length - 1]] = value;
		}

		return result;
	}

	private async moveFile(sourcePath: string, destPath: string): Promise<void> {
		try {
			const content = await readTextFile(sourcePath);
			await writeTextFile(destPath, content);
			await this.deleteFile(sourcePath);
		} catch (error) {
			throw createFileSystemError(
				FileSystemErrorCode.WRITE_FAILED,
				`Failed to move file from ${sourcePath} to ${destPath}`,
				error as Error
			);
		}
	}

	private async deleteFile(filePath: string): Promise<void> {
		try {
			const fileExists = await exists(filePath);
			if (fileExists) {
				await remove(filePath);
			}
		} catch (error) {
			console.warn(`Failed to delete file: ${filePath}`, error);
		}
	}

	private async ensureLanguageDirectory(language: string): Promise<void> {
		await this.createLanguageDirectory(language);
	}
}

export const fileSystemService = new TauriFileSystemService();

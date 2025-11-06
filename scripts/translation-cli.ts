#!/usr/bin/env tsx

/**
 * Translation CLI Tool
 * 
 * This script provides command-line interface for managing translations
 * in the AI Auto-Translation system.
 */

import { cliService } from '../src/lib/translation/index';

const args = process.argv.slice(2);
const command = args[0];

async function main(): Promise<void> {
	try {
		switch (command) {
			case 'add-language':
				await handleAddLanguage(args.slice(1));
				break;
			
			case 'translate-all':
				await handleTranslateAll(args.slice(1));
				break;
			
			case 'progress':
				await handleProgress(args.slice(1));
				break;
			
			case 'list':
				await handleList();
				break;
			
			case 'stats':
				await handleStats();
				break;
			
			case 'help':
			case '--help':
			case '-h':
				showHelp();
				break;
			
			default:
				console.error(`❌ Unknown command: ${command}`);
				showHelp();
				process.exit(1);
		}
	} catch (error) {
		const errorMessage = error instanceof Error ? error.message : String(error);
		console.error('❌ Error:', errorMessage);
		process.exit(1);
	}
}

async function handleAddLanguage(args: string[]): Promise<void> {
	if (args.length < 2) {
		console.error('❌ Usage: add-language <language-code> <language-name>');
		console.error('   Example: add-language es "Español"');
		process.exit(1);
	}

	const [languageCode, languageName] = args;
	
	console.log(`🚀 Adding language: ${languageName} (${languageCode})`);
	
	const validation = cliService.validateAndSuggest(languageCode);
	if (!validation.valid) {
		console.error(`❌ Invalid language code: ${languageCode}`);
		if (validation.suggestions && validation.suggestions.length > 0) {
			console.log('💡 Did you mean one of these?');
			validation.suggestions.forEach(suggestion => {
				const name = cliService.getSuggestedLanguageName(suggestion);
				console.log(`   ${suggestion} - ${name}`);
			});
		}
		process.exit(1);
	}

	const suggestedName = cliService.getSuggestedLanguageName(languageCode);
	if (suggestedName && suggestedName !== languageName) {
		console.log(`💡 Suggested name for ${languageCode}: ${suggestedName}`);
		console.log(`   You provided: ${languageName}`);
	}

	await cliService.addLanguage(languageCode, languageName);
}

async function handleTranslateAll(args: string[]): Promise<void> {
	if (args.length < 2) {
		console.error('❌ Usage: translate-all <source-language> <target-language>');
		console.error('   Example: translate-all en es');
		process.exit(1);
	}

	const [sourceLanguage, targetLanguage] = args;
	
	console.log(`🔄 Translating all keys from ${sourceLanguage} to ${targetLanguage}`);
	
	let lastProgress = 0;
	let processedKeys = 0;

	try {
		for await (const progress of cliService.translateAllKeys(sourceLanguage, targetLanguage)) {
			processedKeys++;
			
			if (progress.progress >= lastProgress + 5 || processedKeys % 10 === 0) {
				cliService.showProgress(
					'Translation',
					progress.progress,
					`Processed ${processedKeys} keys`
				);
				lastProgress = progress.progress;
			}
		}
	} catch (error) {
		const errorMessage = error instanceof Error ? error.message : String(error);
		console.error(`\n❌ Translation failed: ${errorMessage}`);
		process.exit(1);
	}
}

async function handleProgress(args: string[]): Promise<void> {
	if (args.length < 1) {
		console.error('❌ Usage: progress <language-code>');
		console.error('   Example: progress es');
		process.exit(1);
	}

	const [languageCode] = args;
	
	try {
		const progress = await cliService.getTranslationProgress(languageCode);
		const percentage = progress.total > 0 ? Math.round((progress.translated / progress.total) * 100) : 0;
		
		console.log(`\n📊 Translation Progress for ${languageCode}:`);
		console.log(`   Total keys: ${progress.total}`);
		console.log(`   Translated: ${progress.translated}`);
		console.log(`   Pending: ${progress.pending}`);
		console.log(`   Progress: ${percentage}%`);
		
		cliService.showProgress('Overall Progress', percentage);
		console.log();
	} catch (error) {
		const errorMessage = error instanceof Error ? error.message : String(error);
		console.error(`❌ Failed to get progress: ${errorMessage}`);
		process.exit(1);
	}
}

async function handleList(): Promise<void> {
	console.log('📋 Listing available languages...\n');
	cliService.displayAvailableLanguages();
}

async function handleStats(): Promise<void> {
	console.log('📊 Loading translation statistics...\n');
	await cliService.displayTranslationStats();
}

function showHelp(): void {
	console.log(`
🌐 Translation CLI Tool

USAGE:
  npm run translate <command> [options]

COMMANDS:
  add-language <code> <name>    Add a new language with automatic translation
                                Example: add-language es "Español"

  translate-all <from> <to>     Translate all keys from source to target language
                                Example: translate-all en es

  progress <language>           Show translation progress for a language
                                Example: progress es

  list                          List all available languages

  stats                         Show translation statistics for all languages

  help                          Show this help message

EXAMPLES:
  npm run translate add-language fr "Français"
  npm run translate translate-all en fr
  npm run translate progress fr
  npm run translate list
  npm run translate stats

For more information, see the translation system documentation.
`);
}

main().catch(error => {
	console.error('❌ Unexpected error:', error);
	process.exit(1);
});
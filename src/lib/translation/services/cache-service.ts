import { CACHE_CONFIG, CACHE_KEYS } from "../constants";
import { CacheErrorCode, createCacheError } from "../errors";
import type { CacheService } from "../types";

class LRUNode {
	constructor(
		public key: string,
		public value: string,
		public prev: LRUNode | null = null,
		public next: LRUNode | null = null
	) {}
}

class LRUCache {
	private capacity: number;
	private cache = new Map<string, LRUNode>();
	private head: LRUNode;
	private tail: LRUNode;

	constructor(capacity: number) {
		this.capacity = capacity;
		this.head = new LRUNode("", "");
		this.tail = new LRUNode("", "");
		this.head.next = this.tail;
		this.tail.prev = this.head;
	}

	get(key: string): string | null {
		const node = this.cache.get(key);
		if (!node) {
			return null;
		}

		this.moveToHead(node);
		return node.value;
	}

	set(key: string, value: string): void {
		const existingNode = this.cache.get(key);

		if (existingNode) {
			existingNode.value = value;
			this.moveToHead(existingNode);
		} else {
			const newNode = new LRUNode(key, value);

			if (this.cache.size >= this.capacity) {
				const tail = this.removeTail();
				if (tail) {
					this.cache.delete(tail.key);
				}
			}

			this.cache.set(key, newNode);
			this.addToHead(newNode);
		}
	}

	delete(key: string): boolean {
		const node = this.cache.get(key);
		if (!node) {
			return false;
		}

		this.removeNode(node);
		this.cache.delete(key);
		return true;
	}

	clear(): void {
		this.cache.clear();
		this.head.next = this.tail;
		this.tail.prev = this.head;
	}

	size(): number {
		return this.cache.size;
	}

	keys(): string[] {
		return Array.from(this.cache.keys());
	}

	private addToHead(node: LRUNode): void {
		node.prev = this.head;
		node.next = this.head.next;

		if (this.head.next) {
			this.head.next.prev = node;
		}
		this.head.next = node;
	}

	private removeNode(node: LRUNode): void {
		if (node.prev) {
			node.prev.next = node.next;
		}
		if (node.next) {
			node.next.prev = node.prev;
		}
	}

	private moveToHead(node: LRUNode): void {
		this.removeNode(node);
		this.addToHead(node);
	}

	private removeTail(): LRUNode | null {
		const lastNode = this.tail.prev;
		if (lastNode && lastNode !== this.head) {
			this.removeNode(lastNode);
			return lastNode;
		}
		return null;
	}
}

export class CacheServiceImpl implements CacheService {
	private translationCache: LRUCache;
	private pendingRequests = new Set<string>();
	private storageKey: string;

	constructor() {
		this.translationCache = new LRUCache(CACHE_CONFIG.MAX_ENTRIES);
		this.storageKey = CACHE_CONFIG.STORAGE_KEY;
		this.loadFromStorage();
	}

	getTranslation(key: string, language: string): string | null {
		try {
			const cacheKey = this.createCacheKey(key, language);
			return this.translationCache.get(cacheKey);
		} catch (error) {
			throw createCacheError(
				CacheErrorCode.INVALID_KEY,
				`Failed to get translation for key: ${key}, language: ${language}`,
				error instanceof Error ? error : undefined
			);
		}
	}

	setTranslation(key: string, language: string, value: string): void {
		try {
			this.validateInputs(key, language, value);
			const cacheKey = this.createCacheKey(key, language);
			this.translationCache.set(cacheKey, value);
			this.saveToStorage();
		} catch (error) {
			throw createCacheError(
				CacheErrorCode.INVALID_KEY,
				`Failed to set translation for key: ${key}, language: ${language}`,
				error instanceof Error ? error : undefined
			);
		}
	}

	isPending(key: string, language: string): boolean {
		try {
			const pendingKey = this.createPendingKey(key, language);
			return this.pendingRequests.has(pendingKey);
		} catch (error) {
			throw createCacheError(
				CacheErrorCode.INVALID_KEY,
				`Failed to check pending status for key: ${key}, language: ${language}`,
				error instanceof Error ? error : undefined
			);
		}
	}

	setPending(key: string, language: string): void {
		try {
			this.validateInputs(key, language);
			const pendingKey = this.createPendingKey(key, language);
			this.pendingRequests.add(pendingKey);
		} catch (error) {
			throw createCacheError(
				CacheErrorCode.INVALID_KEY,
				`Failed to set pending status for key: ${key}, language: ${language}`,
				error instanceof Error ? error : undefined
			);
		}
	}

	removePending(key: string, language: string): void {
		try {
			const pendingKey = this.createPendingKey(key, language);
			this.pendingRequests.delete(pendingKey);
		} catch (error) {
			throw createCacheError(
				CacheErrorCode.INVALID_KEY,
				`Failed to remove pending status for key: ${key}, language: ${language}`,
				error instanceof Error ? error : undefined
			);
		}
	}

	clearCache(): void {
		try {
			this.translationCache.clear();
			this.pendingRequests.clear();
			this.clearStorage();
		} catch (error) {
			throw createCacheError(
				CacheErrorCode.EVICTION_FAILED,
				"Failed to clear cache",
				error instanceof Error ? error : undefined
			);
		}
	}

	getAllTranslations(language: string): Record<string, string> {
		try {
			const result: Record<string, string> = {};
			const languagePrefix = `${CACHE_KEYS.TRANSLATION}:${language}:`;

			for (const cacheKey of this.translationCache.keys()) {
				if (cacheKey.startsWith(languagePrefix)) {
					const translationKey = cacheKey.substring(languagePrefix.length);
					const value = this.translationCache.get(cacheKey);
					if (value !== null) {
						result[translationKey] = value;
					}
				}
			}

			return result;
		} catch (error) {
			throw createCacheError(
				CacheErrorCode.INVALID_KEY,
				`Failed to get all translations for language: ${language}`,
				error instanceof Error ? error : undefined
			);
		}
	}

	hasLanguage(language: string): boolean {
		try {
			const languagePrefix = `${CACHE_KEYS.TRANSLATION}:${language}:`;
			return this.translationCache.keys().some((key) => key.startsWith(languagePrefix));
		} catch (error) {
			throw createCacheError(
				CacheErrorCode.INVALID_KEY,
				`Failed to check if language exists: ${language}`,
				error instanceof Error ? error : undefined
			);
		}
	}

	getStats(): {
		translationCount: number;
		pendingCount: number;
		memoryUsage: number;
	} {
		return {
			translationCount: this.translationCache.size(),
			pendingCount: this.pendingRequests.size,
			memoryUsage: this.estimateMemoryUsage(),
		};
	}

	private createCacheKey(key: string, language: string): string {
		return `${CACHE_KEYS.TRANSLATION}:${language}:${key}`;
	}

	private createPendingKey(key: string, language: string): string {
		return `${CACHE_KEYS.PENDING}:${language}:${key}`;
	}

	private validateInputs(key: string, language: string, value?: string): void {
		if (!key || typeof key !== "string") {
			throw createCacheError(
				CacheErrorCode.INVALID_KEY,
				"Translation key must be a non-empty string"
			);
		}

		if (!language || typeof language !== "string") {
			throw createCacheError(CacheErrorCode.INVALID_KEY, "Language must be a non-empty string");
		}

		if (value !== undefined && typeof value !== "string") {
			throw createCacheError(CacheErrorCode.INVALID_KEY, "Translation value must be a string");
		}
	}

	private estimateMemoryUsage(): number {
		let totalSize = 0;

		for (const cacheKey of this.translationCache.keys()) {
			const value = this.translationCache.get(cacheKey);
			if (value) {
				totalSize += cacheKey.length * 2;
				totalSize += value.length * 2;
			}
		}

		for (const pendingKey of this.pendingRequests) {
			totalSize += pendingKey.length * 2;
		}

		return totalSize;
	}

	private saveToStorage(): void {
		try {
			if (typeof localStorage === "undefined") {
				return;
			}

			const data = {
				translations: {} as Record<string, string>,
				timestamp: Date.now(),
			};

			for (const cacheKey of this.translationCache.keys()) {
				const value = this.translationCache.get(cacheKey);
				if (value) {
					data.translations[cacheKey] = value;
				}
			}

			const serialized = JSON.stringify(data);
			const sizeInMB = new Blob([serialized]).size / (1024 * 1024);

			if (sizeInMB > CACHE_CONFIG.MAX_STORAGE_MB) {
				console.warn(
					`Cache storage size (${sizeInMB.toFixed(2)}MB) exceeds limit (${CACHE_CONFIG.MAX_STORAGE_MB}MB)`
				);
				return;
			}

			localStorage.setItem(this.storageKey, serialized);
		} catch (error) {
			console.warn("Failed to save cache to localStorage:", error);
		}
	}

	private loadFromStorage(): void {
		try {
			if (typeof localStorage === "undefined") {
				return;
			}

			const stored = localStorage.getItem(this.storageKey);
			if (!stored) {
				return;
			}

			const data = JSON.parse(stored);

			if (data.timestamp && Date.now() - data.timestamp > CACHE_CONFIG.TTL_MS) {
				this.clearStorage();
				return;
			}

			if (data.translations && typeof data.translations === "object") {
				for (const [cacheKey, value] of Object.entries(data.translations)) {
					if (typeof value === "string") {
						this.translationCache.set(cacheKey, value);
					}
				}
			}
		} catch (error) {
			console.warn("Failed to load cache from localStorage:", error);
			this.clearStorage();
		}
	}

	private clearStorage(): void {
		try {
			if (typeof localStorage !== "undefined") {
				localStorage.removeItem(this.storageKey);
			}
		} catch (error) {
			console.warn("Failed to clear cache from localStorage:", error);
		}
	}
}

export const cacheService = new CacheServiceImpl();

import { Injectable, Logger } from '@nestjs/common';

/**
 * Service for caching data in memory to improve performance
 */
@Injectable()
export class CacheService {
  private readonly logger = new Logger(CacheService.name);
  private cache: Map<string, { value: any; expiry: number }> = new Map();

  constructor() {
    this.logger.log('Cache service initialized');
  }

  /**
   * Get a value from the cache
   * @param key The cache key
   * @returns The cached value or undefined if not found
   */
  get<T>(key: string): T | undefined {
    const item = this.cache.get(key);
    if (!item) return undefined;

    if (Date.now() > item.expiry) {
      this.cache.delete(key);
      return undefined;
    }

    return item.value as T;
  }

  /**
   * Set a value in the cache
   * @param key The cache key
   * @param value The value to cache
   * @param ttlSeconds Time to live in seconds
   * @returns true if the value was set successfully
   */
  set<T>(key: string, value: T, ttlSeconds: number): boolean {
    const expiry = Date.now() + ttlSeconds * 1000;
    this.cache.set(key, { value, expiry });
    return true;
  }

  /**
   * Delete a value from the cache
   * @param key The cache key
   * @returns true if the value was deleted, false if it wasn't in the cache
   */
  delete(key: string): boolean {
    return this.cache.delete(key);
  }

  /**
   * Check if a key exists in the cache
   * @param key The cache key
   * @returns true if the key exists
   */
  has(key: string): boolean {
    return this.cache.has(key);
  }

  /**
   * Clear all items from the cache
   */
  clear(): void {
    this.cache.clear();
    this.logger.log('Cache cleared');
  }

  /**
   * Get cache stats
   * @returns Object with cache statistics
   */
  getStats() {
    // Implement cache stats retrieval logic
  }

  /**
   * Cache user permissions
   * @param userId The user ID
   * @param permissions Array of permission strings
   * @param ttlSeconds Time to live in seconds
   * @returns true if cached successfully
   */
  cacheUserPermissions(
    userId: number,
    permissions: string[],
    ttlSeconds: number,
  ): boolean {
    return this.set(
      `permission:${userId}:permissions`,
      permissions,
      ttlSeconds,
    );
  }

  /**
   * Get cached user permissions
   * @param userId The user ID
   * @returns Array of permission strings or undefined if not in cache
   */
  getUserPermissions(userId: number): string[] | undefined {
    return this.get<string[]>(`permission:${userId}:permissions`);
  }

  /**
   * Clear cached permissions for a specific user
   * @param userId The user ID
   * @returns true if permissions were found and deleted
   */
  clearUserPermissions(userId: number): boolean {
    const prefix = `permission:${userId}:`;
    for (const key of this.cache.keys()) {
      if (key.startsWith(prefix)) {
        this.cache.delete(key);
      }
    }
    return true;
  }

  /**
   * Clear all user permissions from cache
   */
  clearAllPermissions(): void {
    for (const key of this.cache.keys()) {
      if (key.startsWith('permission:')) {
        this.cache.delete(key);
      }
    }
  }

  /**
   * Get all cached items
   * @returns Object with all cached items
   */
  getAll(): { [key: string]: any } {
    const result: { [key: string]: any } = {};
    for (const [key, item] of this.cache.entries()) {
      if (Date.now() <= item.expiry) {
        result[key] = item.value;
      } else {
        this.cache.delete(key);
      }
    }
    return result;
  }

  /**
   * Get all keys in the cache
   * @returns Array of cache keys
   */
  getAllKeys(): string[] {
    return Array.from(this.cache.keys());
  }
}

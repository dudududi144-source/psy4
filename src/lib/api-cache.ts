// src/lib/api-cache.ts
// In-memory cache for API responses — reduces DB load + improves stability.
//
// The dev server was crashing under rapid sequential requests because each
// request triggered DB queries + compilation. This cache:
// 1. Caches GET responses for 5 seconds (configurable per route)
// 2. Deduplicates concurrent identical requests (single-flight)
// 3. Reduces memory pressure by avoiding redundant DB reads

interface CacheEntry {
  data: any;
  expiresAt: number;
}

const cache = new Map<string, CacheEntry>();
const pendingRequests = new Map<string, Promise<any>>();

/**
 * Get cached data or compute + cache it.
 * Deduplicates concurrent requests (single-flight pattern).
 */
export async function cachedGet<T>(
  key: string,
  ttlMs: number,
  compute: () => Promise<T>,
): Promise<T> {
  // Check cache first
  const cached = cache.get(key);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.data as T;
  }

  // Check if there's already a pending request for this key
  const pending = pendingRequests.get(key);
  if (pending) {
    return pending as Promise<T>;
  }

  // Start a new request
  const promise = compute().then(result => {
    cache.set(key, { data: result, expiresAt: Date.now() + ttlMs });
    pendingRequests.delete(key);
    return result;
  }).catch(err => {
    pendingRequests.delete(key);
    throw err;
  });

  pendingRequests.set(key, promise);
  return promise;
}

/**
 * Invalidate a cache entry (call after POST/PUT/DELETE).
 */
export function invalidateCache(prefix: string): void {
  for (const key of cache.keys()) {
    if (key.startsWith(prefix)) {
      cache.delete(key);
    }
  }
}

/**
 * Simple rate limiter — max N requests per window per user.
 * Returns true if allowed, false if rate-limited.
 */
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();

export function rateLimit(userId: string, maxRequests: number = 60, windowMs: number = 60000): boolean {
  const key = userId;
  const now = Date.now();
  const entry = rateLimitMap.get(key);

  if (!entry || entry.resetAt < now) {
    // New window
    rateLimitMap.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }

  if (entry.count >= maxRequests) {
    return false;  // rate limited
  }

  entry.count++;
  return true;
}

/**
 * DOGS Sampler — device-local search result cache.
 *
 * Keeps recent provider searches in the user's own localStorage so repeat
 * queries don't hit Freesound / the Internet Archive again. Per the repo's
 * cost discipline (AGENTS.md), the cache is pure, zero-dependency, and
 * storage-agnostic: every function takes a `store` shaped like localStorage
 * (`getItem` / `setItem` / `removeItem` / `length` / `key`), so the module is
 * unit-testable without a browser.
 *
 * Entries are `{ v, savedAt, ttlMs, payload }` JSON blobs under keys starting
 * with {@link CACHE_KEY_PREFIX}. Corrupt or version-stale entries are dropped
 * on read; expired entries are dropped lazily and evicted in bulk on write.
 * All storage failures (private mode, quota, missing storage) are swallowed —
 * the search service simply falls back to the network.
 */

/** Storage key prefix for cached searches (never collide with keys storage). */
const CACHE_KEY_PREFIX = 'dogs-sampler:search:';
/** Entry format version — bump to invalidate every stored search at once. */
const CACHE_VERSION = 1;
/** Max cached searches kept per device; oldest savedAt evicted first. */
const CACHE_MAX_ENTRIES = 20;
/** Default entry lifetime: repeat searches within 6h reuse the stored set. */
const CACHE_DEFAULT_TTL_MS = 6 * 60 * 60 * 1000;

/**
 * Build the storage key for a search. Provider names are sorted so fan-out
 * order never changes the key; queries are normalized so "Sick  Snares",
 * "sick snares", and " SICK SNARES " all share one entry.
 * @param {string} query
 * @param {{ providers?: string[], limit?: number, page?: number }} [scope]
 * @returns {string}
 */
function makeCacheKey(query, scope = {}) {
  const normalized = String(query ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
  const providers = [...(scope.providers ?? [])].sort().join(',');
  return `${CACHE_KEY_PREFIX}v${CACHE_VERSION}:${normalized}|${providers}|${scope.limit ?? 24}|${scope.page ?? 1}`;
}

/**
 * Resolve the default store (browser localStorage), or null outside a browser
 * or when storage access throws (private mode).
 * @returns {Storage|null}
 */
function defaultStore() {
  if (typeof localStorage === 'undefined') return null;
  try {
    return localStorage;
  } catch {
    return null;
  }
}

/**
 * @param {Storage} store
 * @param {string} key
 */
function removeQuietly(store, key) {
  try {
    store.removeItem(key);
  } catch {
    // Storage already gone or read-only — nothing to clean up.
  }
}

/**
 * List every cache key present in the store.
 * @param {Storage|null} store
 * @returns {string[]}
 */
function cacheKeys(store) {
  if (!store || typeof store.length !== 'number' || typeof store.key !== 'function') return [];
  const keys = [];
  try {
    for (let i = 0; i < store.length; i += 1) {
      const key = store.key(i);
      if (typeof key === 'string' && key.startsWith(CACHE_KEY_PREFIX)) keys.push(key);
    }
  } catch {
    return keys;
  }
  return keys;
}

/**
 * Read a cached payload. Expired, corrupt, or version-stale entries are
 * removed and reported as a miss.
 * @param {Storage|null} store
 * @param {string} key
 * @param {number} [now] Milliseconds epoch; injectable for tests.
 * @returns {any|null} The stored payload, or null on any miss.
 */
function readEntry(store, key, now = Date.now()) {
  if (!store) return null;
  let raw = null;
  try {
    raw = store.getItem(key);
  } catch {
    return null;
  }
  if (!raw) return null;
  let entry = null;
  try {
    entry = JSON.parse(raw);
  } catch {
    removeQuietly(store, key);
    return null;
  }
  const stale =
    !entry ||
    typeof entry !== 'object' ||
    entry.v !== CACHE_VERSION ||
    typeof entry.savedAt !== 'number' ||
    typeof entry.ttlMs !== 'number' ||
    now - entry.savedAt > entry.ttlMs;
  if (stale) {
    removeQuietly(store, key);
    return null;
  }
  return 'payload' in entry ? entry.payload : null;
}

/**
 * Write a payload under `key`, then evict the oldest entries past
 * {@link CACHE_MAX_ENTRIES}. Quota failures are swallowed — the network path
 * is always the fallback.
 * @param {Storage|null} store
 * @param {string} key
 * @param {any} payload JSON-serializable search envelope.
 * @param {{ ttlMs?: number, now?: number }} [options]
 * @returns {boolean} True when the entry was stored.
 */
function writeEntry(store, key, payload, options = {}) {
  if (!store) return false;
  const ttlMs = options.ttlMs ?? CACHE_DEFAULT_TTL_MS;
  const now = options.now ?? Date.now();
  try {
    store.setItem(key, JSON.stringify({ v: CACHE_VERSION, savedAt: now, ttlMs, payload }));
  } catch {
    return false;
  }
  evictOverflow(store);
  return true;
}

/**
 * Remove cache entries beyond {@link CACHE_MAX_ENTRIES}, oldest `savedAt`
 * first. Entries whose timestamp can't be read count as oldest.
 * @param {Storage|null} store
 */
function evictOverflow(store) {
  const keys = cacheKeys(store);
  if (keys.length <= CACHE_MAX_ENTRIES) return;
  const stamped = keys.map((key) => {
    let savedAt = -1;
    try {
      const parsed = JSON.parse(store.getItem(key));
      if (parsed && typeof parsed.savedAt === 'number') savedAt = parsed.savedAt;
    } catch {
      // Unreadable timestamp — treated as oldest and evicted first.
    }
    return { key, savedAt };
  });
  stamped.sort((a, b) => b.savedAt - a.savedAt);
  for (const { key } of stamped.slice(CACHE_MAX_ENTRIES)) removeQuietly(store, key);
}

/**
 * Drop every cached search from the store (e.g. the UI "clear cache" button).
 * Keys outside the cache prefix (like stored API keys) are never touched.
 * @param {Storage|null} store
 * @returns {number} Entries removed.
 */
function clearCache(store) {
  let removed = 0;
  for (const key of cacheKeys(store)) {
    removeQuietly(store, key);
    removed += 1;
  }
  return removed;
}

/**
 * Decide whether a search envelope is worth caching. A total outage — every
 * provider errored — is never pinned, so a transient network failure doesn't
 * lock the UI into an error view for the whole TTL.
 * @param {{ providers?: Array<{ error?: string|null }>, results?: unknown[] }|null} envelope
 * @returns {boolean}
 */
function isCacheableEnvelope(envelope) {
  if (!envelope || !Array.isArray(envelope.providers)) return false;
  const providers = envelope.providers;
  if (providers.length === 0) return false;
  return providers.some((p) => !p || !p.error);
}

export {
  makeCacheKey,
  defaultStore,
  readEntry,
  writeEntry,
  evictOverflow,
  clearCache,
  isCacheableEnvelope,
  CACHE_KEY_PREFIX,
  CACHE_VERSION,
  CACHE_MAX_ENTRIES,
  CACHE_DEFAULT_TTL_MS,
};

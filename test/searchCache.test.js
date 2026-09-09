/**
 * DOGS Sampler — smoke tests for the device-local search result cache.
 *
 * Runs with Node's built-in test runner, no dependencies required:
 *
 *   npm run test:smoke   # node --test test/
 *
 * The cache module is storage-agnostic, so all coverage uses an in-memory
 * localStorage-shaped fake. An integration block pins the search-service
 * wiring: a repeat query with `{ cache: true }` serves the stored envelope
 * (flagged `fromCache`) without hitting providers again, and total outages
 * are never pinned.
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  makeCacheKey,
  readEntry,
  writeEntry,
  evictOverflow,
  clearCache,
  isCacheableEnvelope,
  CACHE_KEY_PREFIX,
  CACHE_MAX_ENTRIES,
  CACHE_DEFAULT_TTL_MS,
} from '../src/lib/searchCache.js';
import {
  BaseSampleProvider,
  SampleSearchService,
} from '../src/lib/sampleService.js';

// ── Stubs ────────────────────────────────────────────────────────────────────

const realLocalStorage = globalThis.localStorage;

class MemoryStorage {
  constructor() {
    this.store = new Map();
  }
  getItem(key) {
    return this.store.has(key) ? this.store.get(key) : null;
  }
  setItem(key, value) {
    this.store.set(key, String(value));
  }
  removeItem(key) {
    this.store.delete(key);
  }
  get length() {
    return this.store.size;
  }
  key(index) {
    const keys = [...this.store.keys()];
    return index < keys.length ? keys[index] : null;
  }
}

/** Minimal provider whose _search returns canned results and counts calls. */
class CountingProvider extends BaseSampleProvider {
  constructor(name, behavior = 'ok') {
    super(name, false);
    this.behavior = behavior;
    this.calls = 0;
  }
  async _search(query) {
    this.calls += 1;
    if (this.behavior === 'throw') throw new Error('boom');
    return {
      provider: this.name,
      results: [
        {
          id: '1',
          provider: this.name,
          title: `hit for ${query}`,
          duration: 1.5,
          previewUrl: 'https://example.com/preview.mp3',
          pageUrl: 'https://example.com/1',
          license: null,
          tags: ['test'],
        },
      ],
      total: 1,
      error: null,
    };
  }
}

let store;
beforeEach(() => {
  store = new MemoryStorage();
  globalThis.localStorage = store;
});
afterEach(() => {
  if (realLocalStorage === undefined) delete globalThis.localStorage;
  else globalThis.localStorage = realLocalStorage;
});

const payload = (n) => ({ query: 'kick', providers: [], results: [{ id: n }] });

// ── makeCacheKey ─────────────────────────────────────────────────────────────

describe('makeCacheKey', () => {
  it('normalizes case and whitespace so repeat queries share an entry', () => {
    const a = makeCacheKey('Sick  Snares', { providers: ['freesound'] });
    const b = makeCacheKey('  sick snares ', { providers: ['freesound'] });
    assert.equal(a, b);
  });

  it('sorts provider names so fan-out order never splits the cache', () => {
    const a = makeCacheKey('kick', { providers: ['archive', 'freesound'] });
    const b = makeCacheKey('kick', { providers: ['freesound', 'archive'] });
    assert.equal(a, b);
  });

  it('scopes on limit and page', () => {
    const base = makeCacheKey('kick', { providers: ['a'] });
    assert.notEqual(base, makeCacheKey('kick', { providers: ['a'], limit: 48 }));
    assert.notEqual(base, makeCacheKey('kick', { providers: ['a'], page: 2 }));
  });

  it('scopes on the provider set (degraded mode never reuses a keyed entry)', () => {
    const a = makeCacheKey('kick', { providers: ['freesound'] });
    const b = makeCacheKey('kick', { providers: ['freesound', 'local'] });
    assert.notEqual(a, b);
  });

  it('uses the dogs-sampler search prefix', () => {
    assert.ok(makeCacheKey('kick').startsWith(CACHE_KEY_PREFIX));
  });
});

// ── readEntry / writeEntry ───────────────────────────────────────────────────

describe('readEntry / writeEntry', () => {
  it('round-trips a payload through the default TTL', () => {
    const key = makeCacheKey('kick', { providers: ['a'] });
    assert.equal(readEntry(store, key), null);
    assert.equal(writeEntry(store, key, payload(1)), true);
    assert.deepEqual(readEntry(store, key), payload(1));
  });

  it('expires entries past their TTL and cleans them up', () => {
    const key = makeCacheKey('kick', { providers: ['a'] });
    writeEntry(store, key, payload(1), { ttlMs: 1000, now: 1000 });
    assert.deepEqual(readEntry(store, key, 1500), payload(1));
    assert.equal(readEntry(store, key, 2500), null);
    assert.equal(store.getItem(key), null);
  });

  it('honors the default 6h TTL', () => {
    assert.equal(CACHE_DEFAULT_TTL_MS, 6 * 60 * 60 * 1000);
  });

  it('treats corrupt JSON as a miss and removes it', () => {
    const key = makeCacheKey('kick', { providers: ['a'] });
    store.setItem(key, '{not-json');
    assert.equal(readEntry(store, key), null);
    assert.equal(store.getItem(key), null);
  });

  it('treats version-stale entries as a miss (schema can change safely)', () => {
    const key = makeCacheKey('kick', { providers: ['a'] });
    store.setItem(key, JSON.stringify({ v: 999, savedAt: Date.now(), ttlMs: 60000, payload: payload(1) }));
    assert.equal(readEntry(store, key), null);
  });

  it('returns null without a store (SSR / no localStorage)', () => {
    assert.equal(readEntry(null, 'k'), null);
    assert.equal(writeEntry(null, 'k', payload(1)), false);
  });

  it('swallows quota failures on write instead of throwing', () => {
    const bad = { ...store, setItem: () => { throw new Error('quota'); } };
    assert.equal(writeEntry(bad, 'k', payload(1)), false);
  });
});

// ── evictOverflow / clearCache ───────────────────────────────────────────────

describe('evictOverflow / clearCache', () => {
  it('caps entries at CACHE_MAX_ENTRIES, evicting the oldest first', () => {
    for (let i = 0; i < CACHE_MAX_ENTRIES + 5; i += 1) {
      writeEntry(store, makeCacheKey(`query-${i}`, { providers: ['a'] }), payload(i), {
        ttlMs: CACHE_DEFAULT_TTL_MS,
        now: 1000 + i,
      });
    }
    const keys = [];
    for (let i = 0; i < store.length; i += 1) {
      if (store.key(i).startsWith(CACHE_KEY_PREFIX)) keys.push(store.key(i));
    }
    assert.equal(keys.length, CACHE_MAX_ENTRIES);
    // Oldest (`query-0`) is gone; newest (`query-24`) survived.
    assert.equal(readEntry(store, makeCacheKey('query-0', { providers: ['a'] }), 2000), null);
    assert.deepEqual(readEntry(store, makeCacheKey(`query-${CACHE_MAX_ENTRIES + 4}`, { providers: ['a'] }), 2000), payload(CACHE_MAX_ENTRIES + 4));
  });

  it('clearCache removes only cache keys, never stored API keys', () => {
    writeEntry(store, makeCacheKey('kick', { providers: ['a'] }), payload(1));
    store.setItem('dogs-sampler:keys', JSON.stringify({ freesound: 'secret' }));
    assert.equal(clearCache(store), 1);
    assert.equal(store.getItem('dogs-sampler:keys'), JSON.stringify({ freesound: 'secret' }));
  });
});

// ── isCacheableEnvelope ──────────────────────────────────────────────────────

describe('isCacheableEnvelope', () => {
  const ok = { providers: [{ error: null }], results: [{ id: '1' }] };
  const totalOutage = {
    providers: [{ error: 'down' }, { error: 'boom' }],
    results: [],
  };
  const partial = {
    providers: [{ error: 'down' }, { error: null }],
    results: [],
  };

  it('caches healthy and partially-healthy envelopes', () => {
    assert.equal(isCacheableEnvelope(ok), true);
    assert.equal(isCacheableEnvelope(partial), true);
  });

  it('never pins a total outage', () => {
    assert.equal(isCacheableEnvelope(totalOutage), false);
  });

  it('rejects nulls and empty provider lists', () => {
    assert.equal(isCacheableEnvelope(null), false);
    assert.equal(isCacheableEnvelope({ providers: [], results: [] }), false);
  });
});

// ── Service integration ──────────────────────────────────────────────────────

describe('SampleSearchService cache wiring', () => {
  it('serves repeat queries from cache without re-hitting providers', async () => {
    const provider = new CountingProvider('stub');
    const service = new SampleSearchService([provider]);
    const first = await service.searchAll('sick snares', { cache: true });
    assert.equal(provider.calls, 1);
    assert.equal(first.fromCache ?? false, false);
    const second = await service.searchAll('  SICK  snares ', { cache: true });
    assert.equal(provider.calls, 1);
    assert.equal(second.fromCache, true);
    assert.equal(second.query, 'sick snares');
    assert.deepEqual(second.results, first.results);
  });

  it('does not touch storage when cache is not requested', async () => {
    const provider = new CountingProvider('stub');
    const service = new SampleSearchService([provider]);
    await service.searchAll('kick');
    await service.searchAll('kick');
    assert.equal(provider.calls, 2);
    assert.equal(store.length, 0);
  });

  it('never caches a total outage, so recovery is instant', async () => {
    const provider = new CountingProvider('stub', 'throw');
    const service = new SampleSearchService([provider]);
    await service.searchAll('kick', { cache: true });
    assert.equal(provider.calls, 1);
    assert.equal(store.length, 0);
    await service.searchAll('kick', { cache: true });
    assert.equal(provider.calls, 2);
  });
});

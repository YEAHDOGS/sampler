/**
 * DOGS Sampler — smoke tests for the provider-agnostic search service.
 *
 * Runs with Node's built-in test runner, no dependencies required:
 *
 *   npm run test:smoke   # node --test test/
 *
 * Network calls are never made: fetch and localStorage are stubbed, and the
 * service layer only depends on those two globals. These tests pin the core
 * contract the UI milestone will consume: empty queries, per-provider error
 * envelopes, parallel fan-out that survives a dead provider, and the key
 * storage helpers.
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  BaseSampleProvider,
  FreesoundProvider,
  InternetArchiveProvider,
  PixabayProvider,
  SampleSearchService,
  getEnvKeys,
  getStoredKeys,
  saveKeys,
  clearKeys,
  PROVIDER_FREESOUND,
  PROVIDER_ARCHIVE,
  PROVIDER_PIXABAY,
} from '../src/lib/sampleService.js';

// ── Stubs ────────────────────────────────────────────────────────────────────

const realFetch = globalThis.fetch;
const realLocalStorage = globalThis.localStorage;

let fetchCalls;
function stubFetch(responder) {
  fetchCalls = [];
  globalThis.fetch = async (url, init) => {
    fetchCalls.push(String(url));
    return responder(url, init);
  };
}

function jsonResponse(payload, ok = true, status = 200) {
  return {
    ok,
    status,
    json: async () => payload,
  };
}

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
}

/** Minimal provider whose _search returns canned results. */
class StubProvider extends BaseSampleProvider {
  constructor(name, behavior) {
    super(name, false);
    this.behavior = behavior;
  }
  async _search(query, options) {
    if (this.behavior === 'throw') throw new Error('boom');
    return {
      provider: this.name,
      results: [
        {
          id: '1',
          provider: this.name,
          title: 'canned hit',
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

afterEach(() => {
  globalThis.fetch = realFetch;
  if (realLocalStorage === undefined) delete globalThis.localStorage;
  else globalThis.localStorage = realLocalStorage;
});

// ── Base provider contract ───────────────────────────────────────────────────

describe('BaseSampleProvider', () => {
  it('rejects empty queries without touching the network', async () => {
    stubFetch(() => {
      throw new Error('fetch must not be called');
    });
    const provider = new StubProvider('stub');
    for (const query of ['', '   ']) {
      const result = await provider.search(query);
      assert.deepEqual(result, {
        provider: 'stub',
        results: [],
        total: 0,
        error: 'Empty query.',
      });
    }
    assert.equal(fetchCalls.length, 0);
  });

  it('converts a throwing _search into an error envelope, never a throw', async () => {
    const provider = new StubProvider('stub', 'throw');
    const result = await provider.search('kick');
    assert.equal(result.provider, 'stub');
    assert.deepEqual(result.results, []);
    assert.equal(result.total, null);
    assert.equal(result.error, 'boom');
  });

  it('trims the query before delegating', async () => {
    let seen;
    const provider = new StubProvider('stub');
    const orig = provider._search.bind(provider);
    provider._search = async (q, o) => {
      seen = q;
      return orig(q, o);
    };
    await provider.search('  kick  ');
    assert.equal(seen, 'kick');
  });
});

// ── Service fan-out ──────────────────────────────────────────────────────────

describe('SampleSearchService', () => {
  it('aggregates results across providers', async () => {
    const service = new SampleSearchService([
      new StubProvider('a'),
      new StubProvider('b'),
    ]);
    const out = await service.searchAll('kick');
    assert.equal(out.query, 'kick');
    assert.equal(out.providers.length, 2);
    assert.equal(out.results.length, 2);
    assert.ok(out.providers.every((p) => p.error === null));
  });

  it('survives a dead provider: others still deliver, error is isolated', async () => {
    const service = new SampleSearchService([
      new StubProvider('good'),
      new StubProvider('bad', 'throw'),
    ]);
    const out = await service.searchAll('kick');
    assert.equal(out.results.length, 1);
    assert.equal(out.results[0].provider, 'good');
    const bad = out.providers.find((p) => p.provider === 'bad');
    assert.equal(bad.error, 'boom');
  });

  it('short-circuits empty queries', async () => {
    const service = new SampleSearchService([new StubProvider('a')]);
    assert.deepEqual(await service.searchAll('  '), {
      query: '',
      providers: [],
      results: [],
    });
  });
});

// ── Real providers (stubbed transport) ───────────────────────────────────────

describe('FreesoundProvider', () => {
  beforeEach(() => {
    stubFetch((url) =>
      jsonResponse({
        count: 1,
        results: [
          {
            id: 42,
            name: 'Deep Kick',
            previews: { 'preview-hq-mp3': 'https://freesound.org/p/42.mp3' },
            duration: 0.8,
            license: 'https://creativecommons.org/licenses/by/4.0/',
            url: 'https://freesound.org/s/42/',
            tags: ['kick', 'deep'],
            username: 'dogs',
          },
        ],
      }),
    );
  });

  it('normalizes hits into the SampleResult shape', async () => {
    const provider = new FreesoundProvider();
    assert.equal(provider.name, PROVIDER_FREESOUND);
    const result = await provider.search('kick', { keys: { freesound: 'KEY' } });
    assert.equal(result.error, null);
    assert.equal(result.total, 1);
    const hit = result.results[0];
    assert.deepEqual(Object.keys(hit).sort(), [
      'duration',
      'id',
      'license',
      'pageUrl',
      'previewUrl',
      'provider',
      'tags',
      'title',
    ]);
    assert.equal(hit.id, '42');
    assert.equal(hit.title, 'Deep Kick');
    assert.equal(hit.previewUrl, 'https://freesound.org/p/42.mp3');
    assert.ok(fetchCalls[0].includes('token=KEY'));
  });

  it('asks for a key instead of guessing a URL when none is set', async () => {
    const provider = new FreesoundProvider();
    const result = await provider.search('kick');
    assert.equal(fetchCalls.length, 0);
    assert.ok(result.error.includes('API key'));
  });
});

describe('InternetArchiveProvider', () => {
  it('enriches items into playable results and skips bad ones', async () => {
    stubFetch((url) => {
      const u = String(url);
      if (u.includes('advancedsearch.php')) {
        return jsonResponse({
          response: {
            numFound: 2,
            docs: [
              { identifier: 'good-item', title: 'Good', duration: '3.2' },
              { identifier: 'bad-item', title: 'Bad' },
            ],
          },
        });
      }
      if (u.includes('/metadata/good-item')) {
        return jsonResponse({
          metadata: { title: 'Good Item', licenseurl: 'https://example.com/license' },
          files: [{ name: 'audio.mp3', length: '3.2' }],
        });
      }
      return jsonResponse({}, false, 404);
    });

    const provider = new InternetArchiveProvider();
    assert.equal(provider.name, PROVIDER_ARCHIVE);
    const result = await provider.search('thunder');
    assert.equal(result.error, null);
    assert.equal(result.total, 2);
    // Bad item (404 on metadata) is skipped, not fatal.
    assert.equal(result.results.length, 1);
    const hit = result.results[0];
    assert.equal(hit.id, 'good-item');
    assert.equal(
      hit.previewUrl,
      'https://archive.org/download/good-item/audio.mp3',
    );
    assert.equal(hit.duration, 3.2);
  });

  it('escapes Lucene special chars so user input is searched literally', async () => {
    stubFetch((url) =>
      jsonResponse({ response: { numFound: 0, docs: [] } }),
    );

    const provider = new InternetArchiveProvider();
    const result = await provider.search('hi-hat "deep" (808)');
    assert.equal(result.error, null);
    const q = new URL(fetchCalls[0]).searchParams.get('q');
    // Decoded: hi\-hat \"deep\" \(808\)
    assert.equal(q, 'mediatype:audio AND (hi\\-hat \\"deep\\" \\(808\\))');
  });

  it('leaves plain multi-word queries untouched', async () => {
    stubFetch(() =>
      jsonResponse({ response: { numFound: 0, docs: [] } }),
    );

    const provider = new InternetArchiveProvider();
    await provider.search('sick snares');
    const q = new URL(fetchCalls[0]).searchParams.get('q');
    assert.equal(q, 'mediatype:audio AND (sick snares)');
  });
});

describe('PixabayProvider', () => {
  it('fails loudly instead of guessing an endpoint', async () => {
    stubFetch(() => {
      throw new Error('fetch must not be called');
    });
    const provider = new PixabayProvider();
    assert.equal(provider.name, PROVIDER_PIXABAY);
    const result = await provider.search('sfx', { keys: { pixabay: 'KEY' } });
    assert.equal(fetchCalls.length, 0);
    assert.equal(result.results.length, 0);
    assert.ok(result.error.includes('not wired yet'));
  });
});

// ── Key storage ──────────────────────────────────────────────────────────────

describe('key storage', () => {
  beforeEach(() => {
    globalThis.localStorage = new MemoryStorage();
  });

  it('round-trips keys through localStorage', () => {
    saveKeys({ freesound: '  FS  ', pixabay: 'PX' });
    assert.deepEqual(getStoredKeys(), { freesound: 'FS', pixabay: 'PX' });
    clearKeys();
    assert.deepEqual(getStoredKeys(), {});
  });

  it('returns {} for missing or malformed stored data', () => {
    assert.deepEqual(getStoredKeys(), {});
    globalThis.localStorage.setItem('dogs-sampler:keys', 'not-json{{{');
    assert.deepEqual(getStoredKeys(), {});
  });
});

// ── Env key defaults (injectable source; never committed) ───────────────────

describe('getEnvKeys', () => {
  it('reads VITE_* keys and trims them', () => {
    assert.deepEqual(
      getEnvKeys({ VITE_FREESOUND_API_KEY: '  FS  ', VITE_PIXABAY_API_KEY: 'PX' }),
      { freesound: 'FS', pixabay: 'PX' },
    );
  });

  it('treats blank or missing vars as unset', () => {
    assert.deepEqual(
      getEnvKeys({ VITE_FREESOUND_API_KEY: '   ' }),
      { freesound: undefined, pixabay: undefined },
    );
    assert.deepEqual(getEnvKeys({}), { freesound: undefined, pixabay: undefined });
  });

  it('defaults to import.meta.env (undefined in plain node) without throwing', () => {
    assert.deepEqual(getEnvKeys(), { freesound: undefined, pixabay: undefined });
  });
});

describe('SampleSearchService key precedence', () => {
  class KeyEchoProvider extends BaseSampleProvider {
    constructor() {
      super('echo', false);
    }
    async _search(query, options) {
      return {
        provider: this.name,
        results: [],
        total: 0,
        error: null,
        _seenKeys: options.keys,
      };
    }
  }

  it('explicit options.keys beat stored/env defaults', async () => {
    globalThis.localStorage = new MemoryStorage();
    saveKeys({ freesound: 'STORED' });
    const service = new SampleSearchService([new KeyEchoProvider()]);
    const out = await service.searchAll('kick', { keys: { freesound: 'EXPLICIT' } });
    assert.equal(out.providers[0]._seenKeys.freesound, 'EXPLICIT');
    clearKeys();
  });
});

// ── Freesound edge cases: malformed payloads and sparse hits ────────────────

describe('FreesoundProvider edge cases', () => {
  it('turns a malformed JSON body into an error envelope, never a throw', async () => {
    stubFetch(() => jsonResponse(null));
    const provider = new FreesoundProvider();
    const result = await provider.search('kick', { keys: { freesound: 'KEY' } });
    assert.deepEqual(result.results, []);
    assert.equal(result.provider, PROVIDER_FREESOUND);
    assert.ok(result.error, 'malformed body must surface as an error envelope');
  });

  it('reports HTTP failures with the status, not a crash', async () => {
    stubFetch(() => jsonResponse({ message: 'rate limited' }, false, 429));
    const provider = new FreesoundProvider();
    const result = await provider.search('kick', { keys: { freesound: 'KEY' } });
    assert.deepEqual(result.results, []);
    assert.ok(result.error.includes('429'), `expected status in error, got: ${result.error}`);
  });

  it('normalizes sparse hits: nulls for missing fields, constructed pageUrl fallback', async () => {
    stubFetch(() =>
      jsonResponse({
        count: 1,
        results: [{ id: 7, name: 'Nameless Hit' }], // no previews, tags, url, username
      }),
    );
    const provider = new FreesoundProvider();
    const result = await provider.search('kick', { keys: { freesound: 'KEY' } });
    assert.equal(result.error, null);
    assert.equal(result.results.length, 1);
    const hit = result.results[0];
    assert.equal(hit.id, '7');
    assert.equal(hit.previewUrl, null);
    assert.equal(hit.duration, null);
    assert.deepEqual(hit.tags, []);
    assert.ok(
      hit.pageUrl.includes('/7/'),
      `pageUrl fallback should embed the sound id, got: ${hit.pageUrl}`,
    );
  });

  it('falls back to /s/<id>/ (302s to canonical) when username is missing', async () => {
    stubFetch(() =>
      jsonResponse({
        count: 1,
        results: [{ id: 7, name: 'Nameless Hit' }], // no url, no username
      }),
    );
    const provider = new FreesoundProvider();
    const result = await provider.search('kick', { keys: { freesound: 'KEY' } });
    assert.equal(result.error, null);
    assert.equal(result.results[0].pageUrl, 'https://freesound.org/s/7/');
  });

  it('builds the canonical people URL when username is present but url is not', async () => {
    stubFetch(() =>
      jsonResponse({
        count: 1,
        results: [{ id: 9, name: 'Snare', username: 'dogs' }],
      }),
    );
    const provider = new FreesoundProvider();
    const result = await provider.search('kick', { keys: { freesound: 'KEY' } });
    assert.equal(
      result.results[0].pageUrl,
      'https://freesound.org/people/dogs/sounds/9/',
    );
  });

  it('clamps page_size into Freesound\'s 1..100 range', async () => {
    stubFetch(() => jsonResponse({ count: 0, results: [] }));
    const provider = new FreesoundProvider();
    await provider.search('kick', { keys: { freesound: 'KEY' }, limit: 500 });
    assert.ok(fetchCalls[0].includes('page_size=100'), fetchCalls[0]);
    await provider.search('kick', { keys: { freesound: 'KEY' }, limit: 0 });
    assert.ok(fetchCalls[1].includes('page_size=1'), fetchCalls[1]);
  });
});

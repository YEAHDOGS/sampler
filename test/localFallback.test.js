/**
 * DOGS Sampler — offline/degraded-mode fallback tests.
 *
 * Runs with Node's built-in test runner, no dependencies required:
 *
 *   node --test test/
 *
 * When no API key is configured for any keyed provider (Freesound/Pixabay),
 * SampleSearchService appends a LocalFixtureProvider serving the bundled
 * synthesized WAVs from `public/fixtures/` — the app must still work instead
 * of erroring. Network is never touched: fetch is stubbed to throw, and the
 * fixture WAVs are asserted from disk.
 */

import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  BaseSampleProvider,
  FreesoundProvider,
  LocalFixtureProvider,
  SampleSearchService,
  PROVIDER_LOCAL,
} from '../src/lib/sampleService.js';
import {
  LOCAL_FIXTURES,
  FIXTURE_LICENSE,
  fixturePreviewUrl,
  localFixtureResults,
} from '../src/lib/localFixtures.js';

// ── Stubs ────────────────────────────────────────────────────────────────────

const realFetch = globalThis.fetch;
const realLocalStorage = globalThis.localStorage;

function stubFetchToThrow() {
  globalThis.fetch = async () => {
    throw new Error('fetch must not be called in offline fixture tests');
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

/** Keyless stub provider for the "custom provider list" regression guard. */
class StubProvider extends BaseSampleProvider {
  constructor(name) {
    super(name, false);
  }
  async _search() {
    return { provider: this.name, results: [], total: 0, error: null };
  }
}

afterEach(() => {
  globalThis.fetch = realFetch;
  if (realLocalStorage === undefined) delete globalThis.localStorage;
  else globalThis.localStorage = realLocalStorage;
});

// ── Fixture metadata ─────────────────────────────────────────────────────────

describe('localFixtures', () => {
  it('ships eight fixtures with the full SampleResult shape', () => {
    assert.equal(LOCAL_FIXTURES.length, 8);
    const results = localFixtureResults();
    const ids = new Set();
    for (const hit of results) {
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
      assert.equal(hit.provider, PROVIDER_LOCAL);
      assert.ok(hit.id.startsWith('local:'), `id must be local-scoped, got: ${hit.id}`);
      assert.ok(!ids.has(hit.id), `duplicate fixture id: ${hit.id}`);
      ids.add(hit.id);
      assert.ok(typeof hit.duration === 'number' && hit.duration > 0);
      assert.ok(hit.previewUrl.endsWith('.wav'), hit.previewUrl);
      assert.ok(hit.title.length > 0);
      assert.ok(hit.pageUrl.length > 0);
      assert.ok(hit.license.length > 0);
      assert.ok(Array.isArray(hit.tags) && hit.tags.length > 0);
    }
    assert.equal(ids.size, 8);
  });

  it('labels fixtures as bundled CC0 so licensing stays honest', () => {
    assert.ok(FIXTURE_LICENSE.includes('CC0'));
    for (const hit of localFixtureResults()) {
      assert.equal(hit.license, FIXTURE_LICENSE);
    }
  });

  it('resolves preview URLs against the app base path', () => {
    // import.meta.env is undefined in plain node → base defaults to '/'.
    assert.equal(fixturePreviewUrl('kick.wav'), '/fixtures/kick.wav');
  });

  it('has a real WAV on disk for every fixture', () => {
    const root = join(dirname(fileURLToPath(import.meta.url)), '..');
    for (const fixture of LOCAL_FIXTURES) {
      const path = join(root, 'public', 'fixtures', fixture.file);
      assert.ok(existsSync(path), `missing fixture file: ${path}`);
      const header = readFileSync(path).subarray(0, 4).toString('ascii');
      assert.equal(header, 'RIFF', `${fixture.file} is not a WAV file`);
    }
  });
});

// ── LocalFixtureProvider ─────────────────────────────────────────────────────

describe('LocalFixtureProvider', () => {
  it('serves all fixtures with no network and no key', async () => {
    stubFetchToThrow();
    const provider = new LocalFixtureProvider();
    assert.equal(provider.name, PROVIDER_LOCAL);
    const result = await provider.search('kick');
    assert.equal(result.error, null);
    assert.equal(result.total, 8);
    assert.equal(result.results.length, 8);
  });

  it('ignores empty queries like every other provider', async () => {
    const provider = new LocalFixtureProvider();
    const result = await provider.search('   ');
    assert.deepEqual(result.results, []);
    assert.equal(result.error, 'Empty query.');
  });
});

// ── Degraded-mode wiring in SampleSearchService ──────────────────────────────

describe('SampleSearchService degraded mode', () => {
  function emptyArchiveFetch() {
    globalThis.fetch = async (url) => ({
      ok: true,
      status: 200,
      json: async () =>
        String(url).includes('advancedsearch.php')
          ? { response: { numFound: 0, docs: [] } }
          : { count: 0, results: [] },
    });
  }

  it('appends the local provider when no keyed provider has a key', async () => {
    globalThis.localStorage = new MemoryStorage(); // no stored keys
    emptyArchiveFetch(); // import.meta.env has no VITE_* keys in node
    const service = new SampleSearchService(); // default providers
    const out = await service.searchAll('kick');
    const local = out.providers.find((p) => p.provider === PROVIDER_LOCAL);
    assert.ok(local, 'local fallback provider must be present without keys');
    assert.equal(local.error, null);
    assert.equal(local.results.length, 8);
    assert.ok(local.results.every((r) => r.previewUrl.endsWith('.wav')));
    const freesound = out.providers.find((p) => p.provider === 'freesound');
    assert.ok(freesound.error.includes('API key'), 'freesound still reports its key error');
  });

  it('does NOT append the local provider when a keyed provider has a key', async () => {
    globalThis.localStorage = new MemoryStorage();
    emptyArchiveFetch();
    const service = new SampleSearchService();
    const out = await service.searchAll('kick', { keys: { freesound: 'KEY' } });
    assert.ok(
      !out.providers.some((p) => p.provider === PROVIDER_LOCAL),
      'local fallback must stay out once a key unlocks a provider',
    );
    const freesound = out.providers.find((p) => p.provider === 'freesound');
    assert.equal(freesound.error, null);
  });

  it('appends the fallback for a keyed-only custom list with no key', async () => {
    globalThis.localStorage = new MemoryStorage();
    const service = new SampleSearchService([new FreesoundProvider()]);
    const out = await service.searchAll('kick');
    assert.ok(out.providers.some((p) => p.provider === PROVIDER_LOCAL));
  });

  it('leaves custom keyless provider lists untouched (fan-out contract)', async () => {
    const service = new SampleSearchService([new StubProvider('a'), new StubProvider('b')]);
    const out = await service.searchAll('kick');
    assert.equal(out.providers.length, 2);
    assert.ok(!out.providers.some((p) => p.provider === PROVIDER_LOCAL));
  });
});

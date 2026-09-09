/**
 * i18n regression suite — runs with node:test + node:assert only (no deps).
 * Run: node --test tests/   (or: npm run test:node)
 *
 * Covers src/lib/localeKeys.js with synthetic fixtures, then applies the
 * same helpers as a live regression net over the real locale catalog:
 *   - en/es key parity (missing/extra keys fail)
 *   - every value is a non-empty string
 *   - {token} interpolation sets match across locales
 *   - every $t("...") key used in src/*.svelte exists in the base locale
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  flattenKeys,
  diffKeys,
  interpolationTokens,
  extractMessageKeys,
  lookupKey,
} from '../src/lib/localeKeys.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const readJSON = (p) => JSON.parse(readFileSync(join(ROOT, p), 'utf8'));

/* ------------------------------------------------------------------ */
/* Unit tests — synthetic fixtures                                      */
/* ------------------------------------------------------------------ */

describe('flattenKeys', () => {
  it('flattens nested dictionaries to sorted dotted paths', () => {
    const dict = {
      app: { title: 'T', features: { i18n: 'I', responsive: 'R' } },
      meta: { title: 'M' },
    };
    assert.deepEqual(flattenKeys(dict), [
      'app.features.i18n',
      'app.features.responsive',
      'app.title',
      'meta.title',
    ]);
  });

  it('treats arrays and non-objects as leaves (no crash)', () => {
    assert.deepEqual(flattenKeys({ list: ['a', 'b'], n: 1 }), ['list', 'n']);
  });

  it('returns [] for null, undefined, arrays, and primitives', () => {
    for (const bad of [null, undefined, [], 'x', 42]) {
      assert.deepEqual(flattenKeys(bad), [], `input: ${String(bad)}`);
    }
  });

  it('handles an empty dictionary', () => {
    assert.deepEqual(flattenKeys({}), []);
  });
});

describe('diffKeys', () => {
  it('reports missing and extra keys symmetrically', () => {
    const base = ['a', 'b.c', 'b.d'];
    const target = ['a', 'b.c', 'z'];
    assert.deepEqual(diffKeys(base, target), {
      missing: ['b.d'],
      extra: ['z'],
    });
  });

  it('is clean for identical key sets', () => {
    const keys = ['a', 'b.c'];
    assert.deepEqual(diffKeys(keys, [...keys]), { missing: [], extra: [] });
  });
});

describe('interpolationTokens', () => {
  it('extracts unique sorted tokens from a message', () => {
    assert.deepEqual(
      interpolationTokens('{count} tracks by {artist}, {count} plays'),
      ['artist', 'count']
    );
  });

  it('returns [] for messages without tokens and for non-strings', () => {
    assert.deepEqual(interpolationTokens('plain text'), []);
    assert.deepEqual(interpolationTokens(null), []);
    assert.deepEqual(interpolationTokens(7), []);
  });

  it('ignores empty braces and malformed tokens', () => {
    assert.deepEqual(interpolationTokens('{} {  } {0abc}'), []);
  });
});

describe('extractMessageKeys', () => {
  it('pulls $t("...") keys from svelte markup', () => {
    const src = `
      <title>{$isLoading ? "DOGS" : $t("meta.title")}</title>
      <h1>{$t('app.title')}</h1>
      <p>{t("app.footer.made_by")}</p>
    `;
    assert.deepEqual(extractMessageKeys(src), [
      'app.footer.made_by',
      'app.title',
      'meta.title',
    ]);
  });

  it('dedupes repeated keys and skips non-key parens', () => {
    const src = `$t("a.b") $t("a.b") someFn("not.a.key")`;
    assert.deepEqual(extractMessageKeys(src), ['a.b']);
  });

  it('returns [] for empty or non-string input', () => {
    assert.deepEqual(extractMessageKeys(''), []);
    assert.deepEqual(extractMessageKeys(null), []);
  });
});

describe('lookupKey', () => {
  const dict = { app: { title: 'T', features: { i18n: 'I' } } };

  it('resolves existing dotted paths', () => {
    assert.equal(lookupKey(dict, 'app.title'), 'T');
    assert.equal(lookupKey(dict, 'app.features.i18n'), 'I');
  });

  it('returns undefined for missing paths without throwing', () => {
    assert.equal(lookupKey(dict, 'app.nope'), undefined);
    assert.equal(lookupKey(dict, 'app.title.deeper'), undefined);
    assert.equal(lookupKey(null, 'app.title'), undefined);
    assert.equal(lookupKey(dict, null), undefined);
  });
});

/* ------------------------------------------------------------------ */
/* Live regression — the real locale catalog                            */
/* ------------------------------------------------------------------ */

const LOCALES = ['en', 'es'];
const catalogs = Object.fromEntries(
  LOCALES.map((l) => [l, readJSON(`src/messages/${l}.json`)])
);
const baseKeys = flattenKeys(catalogs.en);

function svelteSources() {
  const files = [];
  const walk = (dir) => {
    for (const entry of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
      const rel = join(dir, entry.name);
      if (entry.isDirectory()) walk(rel);
      else if (/\.(svelte|js)$/.test(entry.name)) files.push(rel);
    }
  };
  walk('src');
  return files;
}

describe('locale catalog (live)', () => {
  it('each locale parses as a non-empty object', () => {
    for (const l of LOCALES) {
      const keys = flattenKeys(catalogs[l]);
      assert.ok(keys.length > 0, `${l}.json has no keys`);
    }
  });

  it('es has full key parity with en (no missing, no extra)', () => {
    const { missing, extra } = diffKeys(baseKeys, flattenKeys(catalogs.es));
    assert.deepEqual(missing, [], `es.json missing keys: ${missing.join(', ')}`);
    assert.deepEqual(extra, [], `es.json extra keys: ${extra.join(', ')}`);
  });

  it('every value in every locale is a non-empty string', () => {
    for (const l of LOCALES) {
      for (const key of flattenKeys(catalogs[l])) {
        const value = lookupKey(catalogs[l], key);
        assert.equal(typeof value, 'string', `${l}:${key} is not a string`);
        assert.ok(value.trim().length > 0, `${l}:${key} is empty/blank`);
      }
    }
  });

  it('interpolation token sets match across locales per key', () => {
    for (const key of baseKeys) {
      const baseTokens = interpolationTokens(lookupKey(catalogs.en, key));
      for (const l of LOCALES) {
        if (l === 'en') continue;
        const tokens = interpolationTokens(lookupKey(catalogs[l], key));
        assert.deepEqual(
          tokens,
          baseTokens,
          `${l}:${key} token mismatch — en={${baseTokens}} ${l}={${tokens}}`
        );
      }
    }
  });

  it('every $t key referenced in src exists in en.json', () => {
    const used = new Set();
    for (const file of svelteSources()) {
      // lib/i18n.js only bootstraps the runtime; localeKeys.js documents the
      // $t("key") pattern in its own JSDoc rather than consuming real keys.
      if (file.endsWith('lib/i18n.js') || file.endsWith('lib/localeKeys.js')) continue;
      const src = readFileSync(join(ROOT, file), 'utf8');
      for (const key of extractMessageKeys(src)) used.add(`${file} :: ${key}`);
    }
    const base = new Set(baseKeys);
    const missing = [...used].filter((f) => !base.has(f.split(' :: ')[1]));
    assert.deepEqual(missing, [], `undefined keys used in src: ${missing.join(', ')}`);
  });

  it('no locale is an untranslated copy of English (brand terms excepted)', () => {
    // Guard against copy-paste locales: translated values must differ from en
    // unless the value is a short brand/proper noun like "DOGS".
    const isBrandTerm = (v) => v.length <= 12 || v === v.toUpperCase();
    for (const l of LOCALES) {
      if (l === 'en') continue;
      for (const key of baseKeys) {
        const enVal = lookupKey(catalogs.en, key);
        const val = lookupKey(catalogs[l], key);
        if (typeof enVal === 'string' && typeof val === 'string' && val === enVal && !isBrandTerm(enVal)) {
          assert.fail(`${l}:${key} is an untranslated copy of the English string`);
        }
      }
    }
  });
});

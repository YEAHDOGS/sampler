/**
 * tests/smoke.mjs — zero-dependency regression checks for DOGS Sampler.
 *
 * Runs on stock Node (no npm install, no network) via:
 *   node --test tests/smoke.mjs
 *
 * Catches the recurring breakages on this repo:
 *  - i18n dictionaries drifting out of sync (en vs es key parity)
 *  - $t("...") references in .svelte files pointing at keys that don't exist
 *  - deprecated Svelte 4 `on:` event directives (Svelte 5 wants `onclick`)
 *  - asset imports pointing at missing files
 *  - encoding/parse problems in package.json
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const BOM = '\uFEFF';

/** Read a repo file as UTF-8 text. */
function read(rel) {
  return readFileSync(join(ROOT, rel), 'utf8');
}

/** Recursively list files under a repo dir with the given extension. */
function listFiles(relDir, ext) {
  const out = [];
  const walk = (dir) => {
    for (const entry of readdirSync(join(ROOT, dir))) {
      const rel = join(dir, entry);
      if (statSync(join(ROOT, rel)).isDirectory()) {
        walk(rel);
      } else if (extname(entry) === ext) {
        out.push(rel);
      }
    }
  };
  if (existsSync(join(ROOT, relDir))) walk(relDir);
  return out;
}

/** Flatten a nested JSON object into dot-path keys. */
function flatKeys(obj, prefix = '') {
  const keys = [];
  for (const [k, v] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${k}` : k;
    if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
      keys.push(...flatKeys(v, path));
    } else {
      keys.push(path);
    }
  }
  return keys.sort();
}

/** Resolve a dot-path key against a nested object. */
function lookup(obj, path) {
  return path.split('.').reduce((acc, k) => (acc == null ? acc : acc[k]), obj);
}

const en = JSON.parse(read('src/messages/en.json'));
const es = JSON.parse(read('src/messages/es.json'));

describe('i18n dictionaries', () => {
  it('en and es have identical key sets', () => {
    assert.deepEqual(
      flatKeys(es),
      flatKeys(en),
      'locale key drift: en and es dictionaries are out of sync',
    );
  });

  it('every leaf value is a non-empty string', () => {
    for (const [name, dict] of [['en', en], ['es', es]]) {
      for (const key of flatKeys(dict)) {
        const value = lookup(dict, key);
        assert.equal(typeof value, 'string', `${name}.${key} is not a string`);
        assert.ok(value.trim().length > 0, `${name}.${key} is empty`);
      }
    }
  });
});

describe('$t() references in Svelte templates', () => {
  const svelteFiles = listFiles('src', '.svelte');
  assert.ok(svelteFiles.length > 0, 'no .svelte files found under src/');

  it('every $t("key") resolves against en.json', () => {
    const missing = [];
    const pattern = /\$t\(\s*['"]([^'"]+)['"]\s*\)/g;
    for (const file of svelteFiles) {
      const source = read(file);
      let match;
      while ((match = pattern.exec(source)) !== null) {
        if (lookup(en, match[1]) === undefined) {
          missing.push(`${file}: ${match[1]}`);
        }
      }
    }
    assert.deepEqual(missing, [], 'dangling i18n keys referenced in templates');
  });

  it('no deprecated Svelte 4 `on:` event directives remain', () => {
    const legacy = [];
    const pattern = /\son:(click|input|change|submit|keydown|keyup|focus|blur)=/g;
    for (const file of svelteFiles) {
      if (pattern.test(read(file))) legacy.push(file);
      pattern.lastIndex = 0;
    }
    assert.deepEqual(legacy, [], 'use Svelte 5 `onclick` etc. instead of `on:click`');
  });
});

describe('asset imports', () => {
  it('every statically imported asset exists on disk', () => {
    const svelteFiles = listFiles('src', '.svelte');
    const missing = [];
    const pattern = /import\s+\w+\s+from\s+['"](\.\/[^'"]+\.(svg|png|jpg|jpeg|webp|gif|ico))['"]/g;
    for (const file of svelteFiles) {
      const dir = dirname(file);
      const source = read(file);
      let match;
      while ((match = pattern.exec(source)) !== null) {
        const resolved = join(dir, match[1]);
        if (!existsSync(join(ROOT, resolved))) {
          missing.push(`${file} -> ${match[1]}`);
        }
      }
    }
    assert.deepEqual(missing, [], 'imported assets missing from disk');
  });
});

describe('project hygiene', () => {
  it('package.json parses and has no UTF-8 BOM', () => {
    const raw = read('package.json');
    assert.ok(!raw.startsWith(BOM), 'package.json starts with a UTF-8 BOM');
    const pkg = JSON.parse(raw);
    assert.ok(pkg.name, 'package.json has no name');
    assert.ok(pkg.scripts && pkg.scripts.dev, 'package.json has no dev script');
  });

  it('viewport-height layout uses valid Tailwind height utilities', () => {
    const source = read('src/App.svelte');
    const bogus = [...source.matchAll(/\b(?:h|max-h|min-h)-(\d+)(dvh|svh|lvh)\b/g)];
    assert.deepEqual(
      bogus.map((m) => m[0]),
      [],
      'Tailwind has no h-100dvh-style utilities; use h-dvh / max-h-dvh (v4)',
    );
  });
});

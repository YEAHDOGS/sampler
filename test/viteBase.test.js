/**
 * DOGS Sampler — production base-path smoke test (zero-dependency).
 *
 * Pins the GitHub Pages convention used across YEAHDOGS web apps:
 * `vite.config.js` must serve at root in dev but emit the '/sampler/'
 * base when built with GITHUB_PAGES=1, and the root-absolute public
 * assets referenced from index.html must exist on disk (Vite rebases
 * them with the base path at build time).
 *
 * Runs under `npm run test:smoke` (node --test, no deps, no network).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(root, p), 'utf8');

describe('production base path (GitHub Pages)', () => {
  it('vite.config.js keeps dev at root', () => {
    const config = read('vite.config.js');
    assert.match(
      config,
      /base:\s*process\.env\.GITHUB_PAGES\s*\?\s*'\/sampler\/'\s*:\s*'\/'/,
      'base must be conditional: /sampler/ for GITHUB_PAGES=1, / for dev',
    );
  });

  it('public assets referenced from index.html exist on disk', () => {
    const html = read('index.html');
    const refs = [...html.matchAll(/href="(\/[^"]+)"/g)].map((m) => m[1]);
    assert.ok(refs.length > 0, 'expected root-absolute asset refs in index.html');
    for (const ref of refs) {
      assert.ok(
        existsSync(join(root, 'public', ref.slice(1))),
        `${ref} referenced in index.html is missing from public/`,
      );
    }
  });

  it('offline fixture audio files exist under public/fixtures', () => {
    const files = [
      'kick.wav', 'snare.wav', 'hihat.wav', 'clap.wav',
      'tom.wav', 'rim.wav', 'shaker.wav', 'sub.wav',
    ];
    for (const file of files) {
      assert.ok(
        existsSync(join(root, 'public', 'fixtures', file)),
        `public/fixtures/${file} is missing`,
      );
    }
  });
});

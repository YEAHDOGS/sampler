/**
 * DOGS Sampler — regression tests for the filter/sort helpers.
 *
 * Zero-dependency, runs with Node's built-in test runner:
 *
 *   node --test test/filterSamples.test.js
 *
 * These pin the client-side filtering contract the SearchView component
 * consumes: duration bounds, license-family classification, sort orders, and
 * the bucket-level wrappers that keep provider metadata intact.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyLicense,
  licenseFamilyLabel,
  filterSamples,
  filterBuckets,
  sortSamples,
  sortBuckets,
  LICENSE_FAMILIES,
  LICENSE_CC0,
  LICENSE_PUBLIC_DOMAIN,
  LICENSE_CC_BY,
  LICENSE_CC_BY_SA,
  LICENSE_CC_BY_NC,
  LICENSE_CC_BY_ND,
  LICENSE_SAMPLING,
  LICENSE_PIXABAY,
  LICENSE_OTHER,
  SORT_RELEVANCE,
  SORT_DURATION_ASC,
  SORT_DURATION_DESC,
  SORT_TITLE_ASC,
} from '../src/lib/filterSamples.js';

/** Minimal SampleResult factory for tests. */
const sample = (overrides = {}) => ({
  id: '1',
  provider: 'freesound',
  title: 'sample',
  duration: 4,
  previewUrl: null,
  pageUrl: 'https://example.com/1',
  license: 'https://creativecommons.org/licenses/by/3.0/',
  tags: [],
  ...overrides,
});

describe('classifyLicense', () => {
  it('classifies Freesound CC URLs into the right family', () => {
    assert.equal(classifyLicense('https://creativecommons.org/licenses/by/3.0/'), LICENSE_CC_BY);
    assert.equal(classifyLicense('https://creativecommons.org/licenses/by-sa/3.0/'), LICENSE_CC_BY_SA);
    assert.equal(classifyLicense('https://creativecommons.org/licenses/by-nc/3.0/'), LICENSE_CC_BY_NC);
    assert.equal(
      classifyLicense('https://creativecommons.org/licenses/by-nc-sa/3.0/'),
      LICENSE_CC_BY_NC,
    );
    assert.equal(classifyLicense('https://creativecommons.org/licenses/by-nd/3.0/'), LICENSE_CC_BY_ND);
    assert.equal(classifyLicense('https://creativecommons.org/licenses/sampling+/1.0/'), LICENSE_SAMPLING);
    assert.equal(classifyLicense('https://creativecommons.org/publicdomain/zero/1.0/'), LICENSE_CC0);
    assert.equal(
      classifyLicense('https://creativecommons.org/publicdomain/mark/1.0/'),
      LICENSE_PUBLIC_DOMAIN,
    );
  });

  it('matches longer patterns first: sampling+ beats sampling, by-nc beats by', () => {
    assert.equal(classifyLicense('Sampling+'), LICENSE_SAMPLING);
    assert.notEqual(classifyLicense('Sampling+'), LICENSE_CC_BY);
    assert.equal(classifyLicense('Creative Commons Attribution-NonCommercial'), LICENSE_CC_BY_NC);
  });

  it('labels Pixabay terms and unknowns', () => {
    assert.equal(classifyLicense('Pixabay Content License'), LICENSE_PIXABAY);
    assert.equal(classifyLicense(null), LICENSE_OTHER);
    assert.equal(classifyLicense(undefined), LICENSE_OTHER);
    assert.equal(classifyLicense('Some Custom Studio License'), LICENSE_OTHER);
  });

  it('every family key has a label', () => {
    for (const family of LICENSE_FAMILIES) {
      const label = licenseFamilyLabel(family);
      assert.ok(label && typeof label === 'string', family);
    }
    assert.equal(licenseFamilyLabel(LICENSE_CC0), 'CC0');
  });
});

describe('filterSamples', () => {
  it('returns everything when no filters are set', () => {
    const results = [sample(), sample({ id: '2' })];
    const out = filterSamples(results);
    assert.deepEqual(out, results);
    assert.notEqual(out, results); // new array, input untouched
  });

  it('filters by min/max duration in seconds', () => {
    const results = [sample({ id: 'a', duration: 2 }), sample({ id: 'b', duration: 10 }), sample({ id: 'c', duration: 60 })];
    assert.deepEqual(
      filterSamples(results, { minDuration: 5, maxDuration: 30 }).map((r) => r.id),
      ['b'],
    );
    assert.deepEqual(
      filterSamples(results, { minDuration: 10 }).map((r) => r.id),
      ['b', 'c'],
    );
    assert.deepEqual(
      filterSamples(results, { maxDuration: 10 }).map((r) => r.id),
      ['a', 'b'],
    );
  });

  it('excludes unknown durations when a bound is set, keeps them otherwise', () => {
    const results = [sample({ id: 'known', duration: 5 }), sample({ id: 'mystery', duration: null })];
    assert.deepEqual(
      filterSamples(results, { minDuration: 1 }).map((r) => r.id),
      ['known'],
    );
    assert.deepEqual(
      filterSamples(results, { maxDuration: 999 }).map((r) => r.id),
      ['known'],
    );
    assert.equal(filterSamples(results).length, 2);
  });

  it('filters by license family', () => {
    const results = [
      sample({ id: 'cc0', license: 'https://creativecommons.org/publicdomain/zero/1.0/' }),
      sample({ id: 'by', license: 'https://creativecommons.org/licenses/by/3.0/' }),
      sample({ id: 'nc', license: 'https://creativecommons.org/licenses/by-nc/3.0/' }),
    ];
    const out = filterSamples(results, { licenses: [LICENSE_CC0, LICENSE_CC_BY] });
    assert.deepEqual(out.map((r) => r.id), ['cc0', 'by']);
  });

  it('treats empty/null license sets as "all families"', () => {
    const results = [sample(), sample({ id: '2' })];
    assert.equal(filterSamples(results, { licenses: [] }).length, 2);
    assert.equal(filterSamples(results, { licenses: null }).length, 2);
    assert.equal(filterSamples(results, { licenses: new Set() }).length, 2);
  });

  it('combines duration and license filters with AND semantics', () => {
    const results = [
      sample({ id: 'hit', duration: 8, license: 'https://creativecommons.org/publicdomain/zero/1.0/' }),
      sample({ id: 'wrong-license', duration: 8, license: 'https://creativecommons.org/licenses/by-nc/3.0/' }),
      sample({ id: 'too-long', duration: 90, license: 'https://creativecommons.org/publicdomain/zero/1.0/' }),
    ];
    const out = filterSamples(results, {
      minDuration: 5,
      maxDuration: 30,
      licenses: [LICENSE_CC0],
    });
    assert.deepEqual(out.map((r) => r.id), ['hit']);
  });

  it('never mutates the input and tolerates empties', () => {
    const results = [sample({ duration: 3 })];
    const snapshot = JSON.stringify(results);
    filterSamples(results, { minDuration: 99 });
    assert.equal(JSON.stringify(results), snapshot);
    assert.deepEqual(filterSamples([]), []);
    assert.deepEqual(filterSamples(null), []);
  });
});

describe('filterBuckets', () => {
  it('filters each bucket but keeps bucket metadata', () => {
    const buckets = [
      {
        provider: 'freesound',
        label: 'Freesound',
        error: null,
        total: 2,
        results: [sample({ id: 'a', duration: 2 }), sample({ id: 'b', duration: 20 })],
      },
      {
        provider: 'pixabay',
        label: 'Pixabay',
        error: 'needs key',
        total: null,
        results: [],
      },
    ];
    const out = filterBuckets(buckets, { minDuration: 10 });
    assert.deepEqual(out[0].results.map((r) => r.id), ['b']);
    assert.equal(out[0].label, 'Freesound');
    assert.equal(out[0].total, 2);
    assert.equal(out[1].error, 'needs key');
    assert.equal(out.length, 2); // error-only buckets survive
    assert.equal(buckets[0].results.length, 2); // input untouched
  });
});

describe('sortSamples', () => {
  it('relevance is a stable no-op pass-through (new array, same order)', () => {
    const results = [sample({ id: 'b', duration: 20 }), sample({ id: 'a', duration: 2 })];
    const out = sortSamples(results, SORT_RELEVANCE);
    assert.deepEqual(out.map((r) => r.id), ['b', 'a']);
    assert.notEqual(out, results);
  });

  it('sorts durations with unknown values last in both directions', () => {
    const results = [
      sample({ id: 'mid', duration: 10 }),
      sample({ id: 'mystery', duration: null }),
      sample({ id: 'short', duration: 2 }),
      sample({ id: 'long', duration: 60 }),
    ];
    assert.deepEqual(
      sortSamples(results, SORT_DURATION_ASC).map((r) => r.id),
      ['short', 'mid', 'long', 'mystery'],
    );
    assert.deepEqual(
      sortSamples(results, SORT_DURATION_DESC).map((r) => r.id),
      ['long', 'mid', 'short', 'mystery'],
    );
  });

  it('sorts titles case-insensitively', () => {
    const results = [
      sample({ id: '1', title: 'zeta' }),
      sample({ id: '2', title: 'Alpha' }),
      sample({ id: '3', title: 'mike' }),
    ];
    assert.deepEqual(
      sortSamples(results, SORT_TITLE_ASC).map((r) => r.id),
      ['2', '3', '1'],
    );
  });

  it('falls back to relevance for unknown sort keys', () => {
    const results = [sample({ id: 'b' }), sample({ id: 'a' })];
    assert.deepEqual(
      sortSamples(results, 'downloads').map((r) => r.id),
      ['b', 'a'],
    );
  });

  it('tolerates empty input', () => {
    assert.deepEqual(sortSamples([]), []);
    assert.deepEqual(sortSamples(null), []);
  });
});

describe('sortBuckets', () => {
  it('sorts each bucket while preserving bucket order and metadata', () => {
    const buckets = [
      {
        provider: 'freesound',
        label: 'Freesound',
        error: null,
        total: 2,
        results: [sample({ id: 'long', duration: 60 }), sample({ id: 'short', duration: 2 })],
      },
    ];
    const out = sortBuckets(buckets, SORT_DURATION_ASC);
    assert.deepEqual(out[0].results.map((r) => r.id), ['short', 'long']);
    assert.equal(out[0].provider, 'freesound');
    assert.equal(buckets[0].results[0].id, 'long'); // input untouched
  });
});

/**
 * DOGS Sampler — regression tests for the display formatting helpers.
 *
 * Zero-dependency, runs with Node's built-in test runner:
 *
 *   node --test test/formatSamples.test.js
 *
 * These pin the formatting contract the SearchView component consumes:
 * duration clocks, provider badge labels, license short-labels, and
 * per-provider result grouping (including error-only provider buckets).
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  formatDuration,
  providerLabel,
  licenseShort,
  groupResultsByProvider,
} from '../src/lib/formatSamples.js';

describe('formatDuration', () => {
  it('formats short clips as m:ss', () => {
    assert.equal(formatDuration(4.2), '0:04');
    assert.equal(formatDuration(245.9), '4:05');
    assert.equal(formatDuration(59), '0:59');
  });

  it('formats long takes as h:mm:ss', () => {
    assert.equal(formatDuration(3600), '1:00:00');
    assert.equal(formatDuration(3750.4), '1:02:30');
  });

  it('shows --:-- when the duration is unknown', () => {
    assert.equal(formatDuration(null), '--:--');
    assert.equal(formatDuration(undefined), '--:--');
    assert.equal(formatDuration(NaN), '--:--');
    assert.equal(formatDuration(-3), '--:--');
  });

  it('floors fractional seconds instead of rounding up', () => {
    assert.equal(formatDuration(4.99), '0:04');
  });
});

describe('providerLabel', () => {
  it('maps provider ids to display labels', () => {
    assert.equal(providerLabel('freesound'), 'Freesound');
    assert.equal(providerLabel('archive'), 'Internet Archive');
    assert.equal(providerLabel('pixabay'), 'Pixabay');
    assert.equal(providerLabel('local'), 'Offline kit');
  });

  it('passes unknown ids through unchanged', () => {
    assert.equal(providerLabel('bandcamp'), 'bandcamp');
  });
});

describe('licenseShort', () => {
  it('shortens Freesound license URLs to known labels', () => {
    assert.equal(
      licenseShort('http://creativecommons.org/licenses/by/3.0/'),
      'CC',
    );
    assert.equal(
      licenseShort('http://creativecommons.org/publicdomain/zero/1.0/'),
      'CC0',
    );
    assert.equal(
      licenseShort('http://creativecommons.org/licenses/sampling+/1.0/'),
      'Sampling+',
    );
  });

  it('checks sampling+ before the bare sampling pattern', () => {
    assert.equal(licenseShort('sampling+'), 'Sampling+');
    assert.equal(licenseShort('sampling'), 'Sampling');
  });

  it('labels public domain and Pixabay hits', () => {
    assert.equal(licenseShort('Public Domain Mark 1.0'), 'Public domain');
    assert.equal(licenseShort('Pixabay Content License'), 'Pixabay');
  });

  it('returns Unknown for missing licenses and raw text otherwise', () => {
    assert.equal(licenseShort(null), 'Unknown');
    assert.equal(licenseShort('some bespoke label'), 'some bespoke label');
  });
});

describe('groupResultsByProvider', () => {
  const envelopes = [
    { provider: 'freesound', error: null, total: 120 },
    { provider: 'archive', error: null, total: 50 },
    { provider: 'pixabay', error: 'Pixabay needs an API key — add yours in Settings.', total: null },
  ];

  it('groups results per provider in first-seen order with labels and totals', () => {
    const results = [
      { id: 'a', provider: 'freesound' },
      { id: 'b', provider: 'archive' },
      { id: 'c', provider: 'freesound' },
    ];
    const buckets = groupResultsByProvider(results, envelopes.slice(0, 2));
    assert.equal(buckets.length, 2);
    assert.equal(buckets[0].provider, 'freesound');
    assert.equal(buckets[0].label, 'Freesound');
    assert.equal(buckets[0].total, 120);
    assert.equal(buckets[0].error, null);
    assert.equal(buckets[0].results.length, 2);
    assert.equal(buckets[1].provider, 'archive');
    assert.equal(buckets[1].label, 'Internet Archive');
  });

  it('keeps error-only providers as buckets with zero results', () => {
    const buckets = groupResultsByProvider(
      [{ id: 'b', provider: 'archive' }],
      envelopes,
    );
    const pixabay = buckets.find((b) => b.provider === 'pixabay');
    assert.ok(pixabay);
    assert.equal(pixabay.results.length, 0);
    assert.equal(pixabay.error, envelopes[2].error);
  });

  it('handles empty input without envelopes', () => {
    assert.deepEqual(groupResultsByProvider([]), []);
  });
});

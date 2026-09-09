/**
 * DOGS Sampler — smoke tests for client-side audio analysis (roadmap #5).
 *
 * Runs with Node's built-in test runner, no dependencies required:
 *
 *   npm run test:smoke   # node --test test/
 *
 * BPM is verified against a synthesized impulse click track at known tempos;
 * key is verified against synthesized sustained triads (C major, A minor).
 * Edge cases pin the null contracts for empty/silent/too-short input, and
 * analysisSimilarity pins the musical-compatibility scoring rules.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  estimateBpm,
  estimateKey,
  analyzeBuffer,
  analysisSimilarity,
  decodePreview,
} from '../src/lib/audioAnalysis.js';

// ── Synthesizers ─────────────────────────────────────────────────────────────

/** Impulse click track at `bpm`, `seconds` long, sampled at `sr`. */
function clickTrack(bpm, seconds, sr) {
  const n = Math.floor(seconds * sr);
  const out = new Float32Array(n);
  const period = Math.round((60 / bpm) * sr);
  for (let i = 0; i < n; i += period) {
    for (let k = 0; k < Math.min(8, n - i); k += 1) out[i + k] = 1 - k / 8;
  }
  return out;
}

/** Sustained sine triad from semitone offsets off C4 (MIDI 60). */
function triad(semitones, seconds, sr) {
  const n = Math.floor(seconds * sr);
  const out = new Float32Array(n);
  const base = 261.63; // C4
  for (const st of semitones) {
    const f = base * 2 ** (st / 12);
    for (let i = 0; i < n; i += 1) out[i] += Math.sin((2 * Math.PI * f * i) / sr);
  }
  for (let i = 0; i < n; i += 1) out[i] /= semitones.length;
  return out;
}

const C_MAJOR = [0, 4, 7]; // C E G
const A_MINOR = [-3, 0, 4]; // A C E

// ── BPM ──────────────────────────────────────────────────────────────────────

describe('estimateBpm', () => {
  it('detects a 120 BPM click track within ±2', () => {
    const res = estimateBpm(clickTrack(120, 4, 8000), 8000);
    assert.ok(res, 'expected a result');
    assert.ok(Math.abs(res.bpm - 120) <= 2, `got ${res.bpm}`);
    assert.ok(res.confidence > 0 && res.confidence <= 1);
  });

  it('detects a 96 BPM click track within ±2', () => {
    const res = estimateBpm(clickTrack(96, 5, 8000), 8000);
    assert.ok(res, 'expected a result');
    assert.ok(Math.abs(res.bpm - 96) <= 2, `got ${res.bpm}`);
  });

  it('detects a fast 160 BPM click track within ±3', () => {
    const res = estimateBpm(clickTrack(160, 4, 8000), 8000);
    assert.ok(res, 'expected a result');
    assert.ok(Math.abs(res.bpm - 160) <= 3, `got ${res.bpm}`);
  });

  it('returns null for empty, silent, or too-short input', () => {
    assert.equal(estimateBpm(new Float32Array(0), 8000), null);
    assert.equal(estimateBpm(new Float32Array(8000 * 4), 8000), null);
    assert.equal(estimateBpm(clickTrack(120, 0.2, 8000), 8000), null);
    assert.equal(estimateBpm(null, 8000), null);
    assert.equal(estimateBpm(clickTrack(120, 4, 8000), 0), null);
  });
});

// ── Key ──────────────────────────────────────────────────────────────────────

describe('estimateKey', () => {
  it('detects C major from a sustained C-E-G triad', () => {
    const res = estimateKey(triad(C_MAJOR, 3, 22050), 22050);
    assert.ok(res, 'expected a result');
    assert.equal(res.key, 'C');
    assert.equal(res.mode, 'major');
    assert.ok(res.confidence > 0.5, `confidence ${res.confidence}`);
  });

  it('detects A minor from a sustained A-C-E triad', () => {
    const res = estimateKey(triad(A_MINOR, 3, 22050), 22050);
    assert.ok(res, 'expected a result');
    assert.equal(res.key, 'A');
    assert.equal(res.mode, 'minor');
  });

  it('returns null for empty, silent, or too-short input', () => {
    assert.equal(estimateKey(new Float32Array(0), 22050), null);
    assert.equal(estimateKey(new Float32Array(22050 * 3), 22050), null);
    assert.equal(estimateKey(new Float32Array(100), 22050), null);
    assert.equal(estimateKey(null, 22050), null);
  });
});

// ── Full buffer analysis ─────────────────────────────────────────────────────

describe('analyzeBuffer', () => {
  it('combines BPM + key and caps the analyzed window', () => {
    const sr = 8000;
    const clicks = clickTrack(120, 40, sr); // 40 s > 30 s cap
    const res = analyzeBuffer(clicks, sr);
    assert.ok(Math.abs(res.bpm - 120) <= 2, `bpm ${res.bpm}`);
    assert.equal(res.duration, 40);
  });

  it('reports nulls (not crashes) on silence', () => {
    const res = analyzeBuffer(new Float32Array(8000 * 3), 8000);
    assert.equal(res.bpm, null);
    assert.equal(res.key, null);
    assert.equal(res.duration, 3);
  });
});

// ── Similarity ───────────────────────────────────────────────────────────────

describe('analysisSimilarity', () => {
  const at120C = { bpm: 120, key: 'C', mode: 'major' };
  const at120C2 = { bpm: 121, key: 'C', mode: 'major' };
  const at60C = { bpm: 60, key: 'C', mode: 'major' }; // half-time
  const relMinor = { bpm: 118, key: 'A', mode: 'minor' }; // relative minor
  const farAway = { bpm: 160, key: 'F#', mode: 'minor' };

  it('scores an identical analysis at 1', () => {
    assert.ok(analysisSimilarity(at120C, at120C) > 0.99);
  });

  it('scores near-identical tempo/key near 1', () => {
    assert.ok(analysisSimilarity(at120C, at120C2) > 0.9);
  });

  it('is half/double-time aware on BPM', () => {
    assert.ok(analysisSimilarity(at120C, at60C) > 0.7);
  });

  it('rewards relative major/minor keys', () => {
    assert.ok(analysisSimilarity(at120C, relMinor) > 0.8);
  });

  it('scores unrelated analyses low', () => {
    assert.ok(analysisSimilarity(at120C, farAway) < 0.3);
  });

  it('returns 0 for missing analyses', () => {
    assert.equal(analysisSimilarity(null, at120C), 0);
    assert.equal(analysisSimilarity(at120C, null), 0);
  });
});

// ── Preview plumbing ─────────────────────────────────────────────────────────

describe('decodePreview', () => {
  it('throws a clear error when browser audio APIs are absent', async () => {
    await assert.rejects(
      decodePreview('https://example.com/x.mp3', {
        fetch: async () => { throw new Error('no-net'); },
        AudioContext: undefined,
      }),
      /audio-analysis-unavailable/,
    );
  });
});

/**
 * DOGS Sampler — regression tests for transient slice-point detection
 * (roadmap #5, slice 3: detectSlicePoints in src/lib/audioAnalysis.js).
 *
 * Runs with Node's built-in test runner, no dependencies required:
 *
 *   npm run test:smoke   # node --test test/
 *
 * Slice accuracy is pinned against synthesized impulse clicks at known
 * times: every click must produce a slice point within ±25 ms, with no
 * extras. Peak-picking properties pin the refractory behavior (rapid
 * re-triggers merge), the adaptive threshold (quiet vs loud transients
 * both detected), the maxPoints cap, and the always-array edge contract.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  detectSlicePoints,
  analyzeBuffer,
  estimateBpm,
} from '../src/lib/audioAnalysis.js';

// ── Synthesizers ─────────────────────────────────────────────────────────────

/** Impulse clicks at the given millisecond offsets, `seconds` long at `sr`. */
function clicksAt(offsetsMs, seconds, sr) {
  const n = Math.floor(seconds * sr);
  const out = new Float32Array(n);
  for (const ms of offsetsMs) {
    const i = Math.round((ms / 1000) * sr);
    for (let k = 0; k < Math.min(8, n - i); k += 1) out[i + k] = 1 - k / 8;
  }
  return out;
}

/** Even click grid: first click at 500 ms, then every `periodMs`. */
function clickGrid(periodMs, seconds, sr) {
  const offsets = [];
  for (let ms = 500; ms < seconds * 1000; ms += periodMs) offsets.push(ms);
  return clicksAt(offsets, seconds, sr);
}

const SR = 8000;
const TOLERANCE_MS = 25; // envelope hop is 5 ms at 8 kHz; plenty of headroom

// ── Accuracy ─────────────────────────────────────────────────────────────────

describe('detectSlicePoints', () => {
  it('detects every click on a 120 BPM grid within ±25 ms, no extras', () => {
    const seconds = 4;
    const expected = [];
    for (let ms = 500; ms < seconds * 1000; ms += 500) expected.push(ms);
    const res = detectSlicePoints(clickGrid(500, seconds, SR), SR);
    assert.equal(res.length, expected.length,
      `expected ${expected.length} slices, got ${res.length}: ${JSON.stringify(res.map((s) => s.timeMs))}`);
    for (let i = 0; i < expected.length; i += 1) {
      assert.ok(
        Math.abs(res[i].timeMs - expected[i]) <= TOLERANCE_MS,
        `slice ${i}: expected ~${expected[i]} ms, got ${res[i].timeMs} ms`,
      );
    }
  });

  it('follows irregular transients, not just an even grid', () => {
    const offsets = [600, 950, 1600, 2300, 3450];
    const res = detectSlicePoints(clicksAt(offsets, 5, SR), SR);
    assert.equal(res.length, offsets.length,
      `expected ${offsets.length} slices, got ${res.length}`);
    for (let i = 0; i < offsets.length; i += 1) {
      assert.ok(
        Math.abs(res[i].timeMs - offsets[i]) <= TOLERANCE_MS,
        `slice ${i}: expected ~${offsets[i]} ms, got ${res[i].timeMs} ms`,
      );
    }
  });

  it('returns slices in ascending time order with confidence in (0,1]', () => {
    const res = detectSlicePoints(clickGrid(500, 4, SR), SR);
    assert.ok(res.length > 0);
    for (let i = 1; i < res.length; i += 1) {
      assert.ok(res[i].timeMs >= res[i - 1].timeMs, 'out of order');
    }
    for (const s of res) {
      assert.ok(s.confidence > 0 && s.confidence <= 1, `bad confidence ${s.confidence}`);
    }
  });

  // ── Peak-picking properties ──────────────────────────────────────────────

  it('merges re-triggers closer than the refractory window into one slice', () => {
    // Two clicks 20 ms apart — inside the 50 ms default refractory window.
    const res = detectSlicePoints(clicksAt([1000, 1020, 2000], 3, SR), SR);
    assert.equal(res.length, 2, `expected 2 slices, got ${res.length}`);
    assert.ok(Math.abs(res[0].timeMs - 1000) <= TOLERANCE_MS);
    assert.ok(Math.abs(res[1].timeMs - 2000) <= TOLERANCE_MS);
  });

  it('detects quiet transients in a dense groove (adaptive threshold)', () => {
    // Loud clicks at 500 ms grid + a faint one (-20 dB) between them.
    const n = 3 * SR;
    const out = clickGrid(1000, 3, SR);
    const faint = Math.round(1.5 * SR);
    for (let k = 0; k < 8 && faint + k < n; k += 1) {
      out[faint + k] += 0.1 * (1 - k / 8);
    }
    const res = detectSlicePoints(out, SR);
    const times = res.map((s) => s.timeMs);
    assert.ok(times.some((t) => Math.abs(t - 1500) <= TOLERANCE_MS),
      `faint transient missed: ${JSON.stringify(times)}`);
  });

  it('honors the maxPoints cap, keeping the strongest onsets', () => {
    const res = detectSlicePoints(clickGrid(100, 4, SR), SR, { maxPoints: 5 });
    assert.equal(res.length, 5);
  });

  // ── Edge contract ────────────────────────────────────────────────────────

  it('returns [] (never null) for silence, too-short, empty, or null input', () => {
    assert.deepEqual(detectSlicePoints(new Float32Array(SR * 4), SR), []);
    assert.deepEqual(detectSlicePoints(clicksAt([200], 0.5, SR), SR), []);
    assert.deepEqual(detectSlicePoints(new Float32Array(0), SR), []);
    assert.deepEqual(detectSlicePoints(null, SR), []);
    assert.deepEqual(detectSlicePoints(clickGrid(500, 4, SR), 0), []);
  });
});

// ── Wiring into the analysis pipeline ────────────────────────────────────────

describe('slice-point pipeline wiring', () => {
  it('analyzeBuffer exposes labeled slices on a click grid', () => {
    const res = analyzeBuffer(clickGrid(500, 4, SR), SR);
    assert.ok(Array.isArray(res.slices), 'slices must be an array');
    assert.equal(res.slices.length, 7,
      `expected 7 slices, got ${res.slices.length}`);
    assert.equal(res.slices[0].label, 'Slice 1');
    assert.equal(res.slices[6].label, 'Slice 7');
    for (const s of res.slices) {
      assert.ok(Number.isFinite(s.timeMs) && s.timeMs >= 0);
    }
  });

  it('analyzeBuffer returns an empty slices array on silence', () => {
    const res = analyzeBuffer(new Float32Array(SR * 3), SR);
    assert.deepEqual(res.slices, []);
    assert.equal(res.bpm, null);
  });

  it('the tempo refactor (fluxEnvelope) still pins 120 BPM within ±2', () => {
    // Regression guard: extracting the shared envelope must not move the
    // tempo estimate that the tempo-sweep test pins at 60–180 BPM.
    const clicks = clickGrid(500, 4, SR);
    const bpm = estimateBpm(clicks, SR);
    assert.ok(bpm, 'expected a result');
    assert.ok(Math.abs(bpm.bpm - 120) <= 2, `got ${bpm.bpm}`);
  });
});

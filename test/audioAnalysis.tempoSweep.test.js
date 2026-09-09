/**
 * DOGS Sampler — tempo-sweep regression for BPM estimation (roadmap #5).
 *
 * Pins the accuracy claim quoted in the README: every tempo in
 * 60–180 BPM (step 10) resolves within ±2 BPM on a synthesized impulse
 * click track. A single change to estimateBpm's onset envelope,
 * upsampling, peak refinement, or octave disambiguation can silently
 * shift individual tempos off-grid — this sweep catches that.
 *
 * Runs with Node's built-in test runner, no dependencies required:
 *
 *   npm run test:smoke   # node --test test/
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { estimateBpm } from '../src/lib/audioAnalysis.js';

// ── Hoisted constants ────────────────────────────────────────────────────
const SAMPLE_RATE = 8000;
const CLIP_SECONDS = 5;
const TOLERANCE_BPM = 2;
const SWEEP_MIN = 60;
const SWEEP_MAX = 180;
const SWEEP_STEP = 10;

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

describe('estimateBpm tempo sweep', () => {
  it('resolves every tempo 60–180 BPM (step 10) within ±2 BPM', () => {
    const misses = [];
    for (let bpm = SWEEP_MIN; bpm <= SWEEP_MAX; bpm += SWEEP_STEP) {
      const res = estimateBpm(clickTrack(bpm, CLIP_SECONDS, SAMPLE_RATE), SAMPLE_RATE);
      if (!res || Math.abs(res.bpm - bpm) > TOLERANCE_BPM) {
        misses.push(`${bpm} -> ${res ? res.bpm.toFixed(2) : 'null'}`);
      }
    }
    assert.deepEqual(misses, [], `missed tempos: ${misses.join(', ')}`);
  });

  it('does not halve/double any tempo in 60–180 BPM (step 10)', () => {
    for (let bpm = SWEEP_MIN; bpm <= SWEEP_MAX; bpm += SWEEP_STEP) {
      const res = estimateBpm(clickTrack(bpm, CLIP_SECONDS, SAMPLE_RATE), SAMPLE_RATE);
      assert.ok(res, `no result for ${bpm} BPM`);
      // Octave disambiguation must never report half-time or double-time.
      assert.ok(
        Math.abs(res.bpm - bpm) <= TOLERANCE_BPM,
        `${bpm} BPM misreported as ${res.bpm.toFixed(2)} (octave error)`,
      );
    }
  });
});

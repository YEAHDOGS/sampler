/**
 * slices regression suite — runs with node:test + node:assert only (no deps).
 * Run: node --test tests/   (or: npm run test:node)
 *
 * Covers src/lib/slices.js (the rhythmic slice-grid engine) with synthetic
 * fixtures: tempo math, grid tiling, slice lookup, MIDI mapping, and
 * guard-clause behavior for garbage input.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  isValidBpm,
  isValidSampleRate,
  secondsPerBeat,
  samplesPerBeat,
  beatsToSeconds,
  secondsToBeats,
  secondsToMs,
  midiNoteForSlice,
  crossfadeSamples,
  buildSliceGrid,
  sliceIndexAtSample,
  sliceAtSecond,
  gridStats,
} from '../src/lib/slices.js';

/* Known-answer constants: 120 BPM @ 44.1kHz. */
const BPM = 120;
const SR = 44100;
const SPB = 22050; // samples per beat at 120 BPM / 44.1kHz

/* ------------------------------------------------------------------ */
/* Validation                                                          */
/* ------------------------------------------------------------------ */

describe('isValidBpm', () => {
  it('accepts musical tempos', () => {
    assert.equal(isValidBpm(20), true);
    assert.equal(isValidBpm(120), true);
    assert.equal(isValidBpm(300), true);
    assert.equal(isValidBpm(140.5), true);
  });

  it('rejects non-tempos', () => {
    for (const bad of [0, -1, 19.9, 300.1, NaN, Infinity, '120', null, undefined]) {
      assert.equal(isValidBpm(bad), false, `input: ${String(bad)}`);
    }
  });
});

describe('isValidSampleRate', () => {
  it('accepts positive finite rates', () => {
    assert.equal(isValidSampleRate(44100), true);
    assert.equal(isValidSampleRate(48000), true);
    assert.equal(isValidSampleRate(0.5), true);
  });

  it('rejects the rest', () => {
    for (const bad of [0, -44100, NaN, Infinity, '44100', null, undefined]) {
      assert.equal(isValidSampleRate(bad), false, `input: ${String(bad)}`);
    }
  });
});

/* ------------------------------------------------------------------ */
/* Tempo math                                                          */
/* ------------------------------------------------------------------ */

describe('secondsPerBeat', () => {
  it('computes known beat periods', () => {
    assert.equal(secondsPerBeat(120), 0.5);
    assert.equal(secondsPerBeat(60), 1);
    assert.equal(secondsPerBeat(140), 60 / 140);
  });

  it('returns 0 for invalid tempos', () => {
    for (const bad of [0, -90, 19, 301, NaN, Infinity]) {
      assert.equal(secondsPerBeat(bad), 0, `input: ${String(bad)}`);
    }
  });
});

describe('samplesPerBeat', () => {
  it('computes known sample counts', () => {
    assert.equal(samplesPerBeat(120, 44100), SPB);
    assert.equal(samplesPerBeat(120, 48000), 24000);
  });

  it('rounds to whole samples', () => {
    const n = samplesPerBeat(128, 44100);
    assert.equal(Number.isInteger(n), true);
    assert.equal(n, Math.round((60 / 128) * 44100));
  });

  it('returns 0 for invalid input', () => {
    assert.equal(samplesPerBeat(0, 44100), 0);
    assert.equal(samplesPerBeat(120, 0), 0);
    assert.equal(samplesPerBeat(120, -1), 0);
  });
});

describe('beatsToSeconds / secondsToBeats', () => {
  it('converts both directions', () => {
    assert.equal(beatsToSeconds(120, 4), 2);
    assert.equal(beatsToSeconds(60, 3), 3);
    assert.equal(secondsToBeats(120, 2), 4);
    assert.equal(secondsToBeats(60, 0.5), 0.5);
  });

  it('round-trips', () => {
    assert.equal(secondsToBeats(128, beatsToSeconds(128, 7)), 7);
  });

  it('returns 0 for invalid input', () => {
    assert.equal(beatsToSeconds(0, 4), 0);
    assert.equal(beatsToSeconds(120, -1), 0);
    assert.equal(beatsToSeconds(120, NaN), 0);
    assert.equal(secondsToBeats(0, 2), 0);
    assert.equal(secondsToBeats(120, -2), 0);
  });
});

describe('secondsToMs', () => {
  it('converts seconds to milliseconds', () => {
    assert.equal(secondsToMs(1), 1000);
    assert.equal(secondsToMs(0.25), 250);
  });

  it('returns 0 for invalid input', () => {
    assert.equal(secondsToMs(-1), 0);
    assert.equal(secondsToMs(NaN), 0);
  });
});

/* ------------------------------------------------------------------ */
/* MIDI + crossfade                                                     */
/* ------------------------------------------------------------------ */

describe('midiNoteForSlice', () => {
  it('maps slices chromatically from the base note', () => {
    assert.equal(midiNoteForSlice(0), 36);
    assert.equal(midiNoteForSlice(12), 48);
    assert.equal(midiNoteForSlice(0, 60), 60);
    assert.equal(midiNoteForSlice(5, 60), 65);
  });

  it('clamps to the MIDI range', () => {
    assert.equal(midiNoteForSlice(200), 127);
    assert.equal(midiNoteForSlice(0, 200), 127);
    assert.equal(midiNoteForSlice(-1), 36);
  });
});

describe('crossfadeSamples', () => {
  it('computes known crossfade lengths', () => {
    assert.equal(crossfadeSamples(44100, 10), 441);
    assert.equal(crossfadeSamples(48000, 5), 240);
  });

  it('returns 0 for invalid input', () => {
    assert.equal(crossfadeSamples(0, 10), 0);
    assert.equal(crossfadeSamples(44100, 0), 0);
    assert.equal(crossfadeSamples(44100, -5), 0);
  });
});

/* ------------------------------------------------------------------ */
/* Slice grid                                                          */
/* ------------------------------------------------------------------ */

describe('buildSliceGrid', () => {
  it('builds an 8-slice 8th-note grid over 4 beats at 120 BPM', () => {
    const length = SPB * 4; // 88200 samples
    const grid = buildSliceGrid({ lengthSamples: length, bpm: BPM, sampleRate: SR, slicesPerBeat: 2 });
    assert.equal(grid.length, 8);
    for (const s of grid) {
      assert.equal(s.endSample - s.startSample, SPB / 2);
    }
    assert.equal(grid[0].startSample, 0);
    assert.equal(grid[7].endSample, length);
    assert.equal(grid[0].midiNote, 36);
    assert.equal(grid[7].midiNote, 43);
    assert.equal(grid[2].startSeconds, (SPB / 2) * 2 / SR);
  });

  it('tiles with no gaps: each slice ends where the next begins', () => {
    const grid = buildSliceGrid({ lengthSamples: 100000, bpm: 128, sampleRate: SR, slicesPerBeat: 4 });
    assert.ok(grid.length > 0);
    for (let i = 1; i < grid.length; i++) {
      assert.equal(grid[i].startSample, grid[i - 1].endSample, `slice ${i}`);
    }
    assert.equal(grid[grid.length - 1].endSample, 100000);
  });

  it('defaults to a quarter-note grid', () => {
    const grid = buildSliceGrid({ lengthSamples: SPB * 4, bpm: BPM, sampleRate: SR });
    assert.equal(grid.length, 4);
  });

  it('honors a custom base MIDI note', () => {
    const grid = buildSliceGrid({ lengthSamples: SPB * 2, bpm: BPM, sampleRate: SR, baseNote: 48 });
    assert.equal(grid[0].midiNote, 48);
    assert.equal(grid[1].midiNote, 49);
  });

  it('clamps garbage slicesPerBeat to 1', () => {
    const a = buildSliceGrid({ lengthSamples: SPB * 4, bpm: BPM, sampleRate: SR, slicesPerBeat: 0 });
    const b = buildSliceGrid({ lengthSamples: SPB * 4, bpm: BPM, sampleRate: SR, slicesPerBeat: -3 });
    assert.equal(a.length, 4);
    assert.equal(b.length, 4);
  });

  it('returns [] for unusable input (never throws)', () => {
    assert.deepEqual(buildSliceGrid({ lengthSamples: 0, bpm: BPM }), []);
    assert.deepEqual(buildSliceGrid({ lengthSamples: -5, bpm: BPM }), []);
    assert.deepEqual(buildSliceGrid({ lengthSamples: 1000, bpm: 0 }), []);
    assert.deepEqual(buildSliceGrid({ lengthSamples: 1000, bpm: BPM, sampleRate: 0 }), []);
    assert.deepEqual(buildSliceGrid(), []);
  });

  it('exposes consistent seconds fields', () => {
    const grid = buildSliceGrid({ lengthSamples: SPB * 2, bpm: BPM, sampleRate: SR });
    for (const s of grid) {
      assert.equal(s.startSeconds, s.startSample / SR);
      assert.equal(s.endSeconds, s.endSample / SR);
      assert.equal(s.durationSeconds, s.endSeconds - s.startSeconds);
    }
  });
});

/* ------------------------------------------------------------------ */
/* Lookup                                                              */
/* ------------------------------------------------------------------ */

describe('sliceIndexAtSample', () => {
  const grid = buildSliceGrid({ lengthSamples: SPB * 4, bpm: BPM, sampleRate: SR }); // 4 quarter slices

  it('finds the containing slice', () => {
    assert.equal(sliceIndexAtSample(grid, 0), 0);
    assert.equal(sliceIndexAtSample(grid, SPB - 1), 0);
    assert.equal(sliceIndexAtSample(grid, SPB), 1);
    assert.equal(sliceIndexAtSample(grid, SPB * 3 + 100), 3);
  });

  it('returns -1 out of bounds or on bad input', () => {
    assert.equal(sliceIndexAtSample(grid, SPB * 4), -1);
    assert.equal(sliceIndexAtSample(grid, -1), -1);
    assert.equal(sliceIndexAtSample(grid, NaN), -1);
    assert.equal(sliceIndexAtSample([], 0), -1);
    assert.equal(sliceIndexAtSample(null, 0), -1);
  });
});

describe('sliceAtSecond', () => {
  const grid = buildSliceGrid({ lengthSamples: SPB * 4, bpm: BPM, sampleRate: SR });

  it('returns the slice at a time position', () => {
    assert.equal(sliceAtSecond(grid, 0, SR).index, 0);
    assert.equal(sliceAtSecond(grid, 0.75, SR).index, 1);
    assert.equal(sliceAtSecond(grid, 1.99, SR).index, 3);
  });

  it('returns null out of bounds or on bad input', () => {
    assert.equal(sliceAtSecond(grid, 2, SR), null);
    assert.equal(sliceAtSecond(grid, -0.5, SR), null);
    assert.equal(sliceAtSecond([], 0, SR), null);
    assert.equal(sliceAtSecond(grid, 0, 0), null);
  });
});

describe('gridStats', () => {
  it('summarizes slices, beats, and duration', () => {
    const grid = buildSliceGrid({ lengthSamples: SPB * 4, bpm: BPM, sampleRate: SR, slicesPerBeat: 2 });
    const stats = gridStats(grid, BPM);
    assert.equal(stats.slices, 8);
    assert.equal(stats.beats, 4);
    assert.equal(stats.durationSeconds, (SPB * 4) / SR);
  });

  it('returns zeros for empty grids and invalid bpm', () => {
    assert.deepEqual(gridStats([], BPM), { slices: 0, beats: 0, durationSeconds: 0 });
    const grid = buildSliceGrid({ lengthSamples: SPB * 4, bpm: BPM, sampleRate: SR });
    assert.deepEqual(gridStats(grid, 0).beats, 0);
    assert.equal(gridStats(grid, 0).slices, 4);
  });
});

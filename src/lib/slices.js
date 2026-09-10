/**
 * Sample slice-grid engine — pure, framework-free math for rhythmic
 * sample slicing and looping (Ableton-style slice-to-MIDI).
 *
 * Zero dependencies; intentionally importable by node:test so the slice
 * math can be regression-tested without a browser or audio context.
 * The UI (Svelte components, Web Audio) consumes these results; heavy
 * slicing logic lives here per AGENTS.md LOGIC ISOLATION.
 *
 * All positions are reported in both samples (DSP-exact) and seconds
 * (UI-friendly). Slice boundaries tile the sample with no gaps.
 */

/** Beats per minute below which tempo math is meaningless. */
const MIN_BPM = 20;

/** Beats per minute above which tempo math is meaningless. */
const MAX_BPM = 300;

/** Seconds in one minute — the beat-period divisor. */
const SECONDS_PER_MINUTE = 60;

/** Fallback sample rate when none is supplied. */
const DEFAULT_SAMPLE_RATE = 44100;

/** Default base MIDI note for slice mapping (note 36). */
const DEFAULT_BASE_MIDI_NOTE = 36;

/** Highest valid MIDI note number. */
const MAX_MIDI_NOTE = 127;

/** Default slice count per beat (quarter-note grid). */
const DEFAULT_SLICES_PER_BEAT = 1;

/**
 * True when bpm is a usable musical tempo.
 * @param {number} bpm - Beats per minute.
 * @returns {boolean} Whether bpm is a finite number inside [MIN_BPM, MAX_BPM].
 */
export function isValidBpm(bpm) {
  return Number.isFinite(bpm) && bpm >= MIN_BPM && bpm <= MAX_BPM;
}

/**
 * True when sampleRate is a usable audio sample rate.
 * @param {number} sampleRate - Samples per second.
 * @returns {boolean} Whether sampleRate is a positive finite number.
 */
export function isValidSampleRate(sampleRate) {
  return Number.isFinite(sampleRate) && sampleRate > 0;
}

/**
 * Length of one beat in seconds.
 * @param {number} bpm - Beats per minute.
 * @returns {number} Seconds per beat, or 0 for an invalid tempo.
 */
export function secondsPerBeat(bpm) {
  if (!isValidBpm(bpm)) return 0;
  return SECONDS_PER_MINUTE / bpm;
}

/**
 * Length of one beat in whole samples.
 * @param {number} bpm - Beats per minute.
 * @param {number} [sampleRate] - Samples per second.
 * @returns {number} Samples per beat (rounded), or 0 for invalid input.
 */
export function samplesPerBeat(bpm, sampleRate = DEFAULT_SAMPLE_RATE) {
  if (!isValidBpm(bpm) || !isValidSampleRate(sampleRate)) return 0;
  return Math.round((SECONDS_PER_MINUTE / bpm) * sampleRate);
}

/**
 * Convert a beat count to seconds at the given tempo.
 * @param {number} bpm - Beats per minute.
 * @param {number} beats - Number of beats.
 * @returns {number} Seconds, or 0 for invalid input.
 */
export function beatsToSeconds(bpm, beats) {
  if (!isValidBpm(bpm) || !Number.isFinite(beats) || beats < 0) return 0;
  return (beats * SECONDS_PER_MINUTE) / bpm;
}

/**
 * Convert a duration in seconds to beats at the given tempo.
 * @param {number} bpm - Beats per minute.
 * @param {number} seconds - Duration in seconds.
 * @returns {number} Beats, or 0 for invalid input.
 */
export function secondsToBeats(bpm, seconds) {
  if (!isValidBpm(bpm) || !Number.isFinite(seconds) || seconds < 0) return 0;
  return (seconds * bpm) / SECONDS_PER_MINUTE;
}

/**
 * Convert a duration in seconds to milliseconds.
 * @param {number} seconds - Duration in seconds.
 * @returns {number} Milliseconds, or 0 for invalid input.
 */
export function secondsToMs(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return 0;
  return seconds * 1000;
}

/**
 * MIDI note for a slice index, ascending chromatically from a base note.
 * Clamped to the MIDI range so long sample grids stay playable.
 * @param {number} index - Zero-based slice index.
 * @param {number} [baseNote] - MIDI note for slice 0.
 * @returns {number} MIDI note number, clamped to [0, 127].
 */
export function midiNoteForSlice(index, baseNote = DEFAULT_BASE_MIDI_NOTE) {
  if (!Number.isFinite(index) || index < 0) return Math.min(MAX_MIDI_NOTE, Math.max(0, baseNote));
  const note = Math.floor(baseNote) + Math.floor(index);
  return Math.min(MAX_MIDI_NOTE, Math.max(0, note));
}

/**
 * Crossfade length in whole samples for smoothing loop seams.
 * @param {number} [sampleRate] - Samples per second.
 * @param {number} [ms] - Crossfade length in milliseconds.
 * @returns {number} Samples, or 0 for invalid input.
 */
export function crossfadeSamples(sampleRate = DEFAULT_SAMPLE_RATE, ms = 10) {
  if (!isValidSampleRate(sampleRate) || !Number.isFinite(ms) || ms <= 0) return 0;
  return Math.round((sampleRate * ms) / 1000);
}

/**
 * Build a rhythmic slice grid over a sample of known length.
 * Slices tile the sample end-to-end with no gaps: slice N ends exactly
 * where slice N+1 begins, and the final slice ends at lengthSamples.
 *
 * @param {object} options - Grid parameters.
 * @param {number} options.lengthSamples - Total sample length in samples.
 * @param {number} options.bpm - Tempo of the source material.
 * @param {number} [options.sampleRate] - Samples per second.
 * @param {number} [options.slicesPerBeat] - Grid density (1 = quarters, 2 = 8ths, 4 = 16ths).
 * @param {number} [options.baseNote] - MIDI note mapped to slice 0.
 * @returns {Array<{index:number,startSample:number,endSample:number,startSeconds:number,endSeconds:number,durationSeconds:number,midiNote:number}>}
 *   Slices in order, or [] when any input is unusable.
 */
export function buildSliceGrid({
  lengthSamples,
  bpm,
  sampleRate = DEFAULT_SAMPLE_RATE,
  slicesPerBeat = DEFAULT_SLICES_PER_BEAT,
  baseNote = DEFAULT_BASE_MIDI_NOTE,
} = {}) {
  if (!Number.isFinite(lengthSamples) || lengthSamples <= 0) return [];
  if (!isValidBpm(bpm)) return [];
  if (!isValidSampleRate(sampleRate)) return [];

  const density = Math.max(1, Math.floor(Number.isFinite(slicesPerBeat) ? slicesPerBeat : DEFAULT_SLICES_PER_BEAT));
  const sliceSamples = samplesPerBeat(bpm, sampleRate) / density;
  if (sliceSamples <= 0) return [];

  const count = Math.max(1, Math.ceil(lengthSamples / sliceSamples));
  const grid = [];
  for (let i = 0; i < count; i++) {
    const startSample = Math.round(i * sliceSamples);
    const endSample = i === count - 1 ? Math.round(lengthSamples) : Math.round((i + 1) * sliceSamples);
    grid.push({
      index: i,
      startSample,
      endSample,
      startSeconds: startSample / sampleRate,
      endSeconds: endSample / sampleRate,
      durationSeconds: (endSample - startSample) / sampleRate,
      midiNote: midiNoteForSlice(i, baseNote),
    });
  }
  return grid;
}

/**
 * Index of the slice containing a sample position.
 * @param {Array} grid - Slice grid from buildSliceGrid.
 * @param {number} sample - Sample position.
 * @returns {number} Slice index, or -1 when out of bounds / grid empty.
 */
export function sliceIndexAtSample(grid, sample) {
  if (!Array.isArray(grid) || grid.length === 0) return -1;
  if (!Number.isFinite(sample) || sample < 0) return -1;
  for (let i = 0; i < grid.length; i++) {
    if (sample < grid[i].endSample) return i;
  }
  return -1;
}

/**
 * The slice containing a time position in seconds.
 * @param {Array} grid - Slice grid from buildSliceGrid.
 * @param {number} seconds - Time position in seconds.
 * @param {number} [sampleRate] - Samples per second (must match the grid).
 * @returns {object|null} The slice, or null when out of bounds / grid empty.
 */
export function sliceAtSecond(grid, seconds, sampleRate = DEFAULT_SAMPLE_RATE) {
  if (!Array.isArray(grid) || grid.length === 0) return null;
  if (!isValidSampleRate(sampleRate)) return null;
  if (!Number.isFinite(seconds) || seconds < 0) return null;
  const index = sliceIndexAtSample(grid, Math.floor(seconds * sampleRate));
  return index === -1 ? null : grid[index];
}

/**
 * Summary stats for a slice grid: total slices, beats, and duration.
 * @param {Array} grid - Slice grid from buildSliceGrid.
 * @param {number} bpm - Tempo the grid was built with.
 * @returns {{slices:number,beats:number,durationSeconds:number}} Stats (zeros for an empty grid).
 */
export function gridStats(grid, bpm) {
  if (!Array.isArray(grid) || grid.length === 0) return { slices: 0, beats: 0, durationSeconds: 0 };
  const last = grid[grid.length - 1];
  return {
    slices: grid.length,
    beats: isValidBpm(bpm) ? secondsToBeats(bpm, last.endSeconds) : 0,
    durationSeconds: last.endSeconds,
  };
}

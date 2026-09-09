/**
 * DOGS Sampler — client-side audio analysis (roadmap milestone #5, slice 1).
 *
 * Vanilla DSP, zero dependencies: BPM via onset-envelope autocorrelation,
 * musical key via FFT chromagram matched against Krumhansl-Schmuckler
 * profiles. Runs entirely on-device against a decoded preview — no provider
 * re-queries, no network beyond fetching the preview itself.
 *
 * All estimators are pure functions of (Float32Array, sampleRate) so they
 * run identically in Node (smoke tests) and the browser. Browser-only
 * plumbing (fetch + AudioContext) is isolated in decodePreview() and
 * analyzePreviewUrl() at the bottom.
 */

// ── Hoisted constants ────────────────────────────────────────────────────
const BPM_MIN = 40;
const BPM_MAX = 200;
const ENVELOPE_HOP_S = 0.005; // 5 ms onset hops — fine enough that common
// tempos land near integer autocorrelation lags (12000/bpm at 200 Hz)
const ANALYSIS_MAX_SECONDS = 30; // cap the analyzed window (speed)
const MIN_ANALYSIS_SECONDS = 1; // refuse anything shorter
const FFT_SIZE = 4096; // must be a power of two
const FFT_HOP = 2048;
const CHROMA_MIN_HZ = 55; // A1 — ignore sub-bass rumble
const CHROMA_MAX_HZ = 2093; // C7 — ignore hiss
const REFERENCE_A_HZ = 440;
const MIDI_A4 = 69;
const KEY_NAMES = [
  "C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B",
];
// Krumhansl-Schmuckler key profiles, rotated so index 0 = tonic.
const PROFILE_MAJOR = [
  6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88,
];
const PROFILE_MINOR = [
  6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17,
];
const SIMILARITY_BPM_TOLERANCE = 40; // BPM difference that scores zero

/**
 * In-place iterative radix-2 FFT. `re`/`im` are same-length Float64Arrays
 * with a power-of-two length.
 */
function fftRadix2(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i += 1) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      const tr = re[i]; re[i] = re[j]; re[j] = tr;
      const ti = im[i]; im[i] = im[j]; im[j] = ti;
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wRe = Math.cos(ang);
    const wIm = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cRe = 1;
      let cIm = 0;
      const half = len >> 1;
      for (let k = 0; k < half; k += 1) {
        const a = i + k;
        const b = a + half;
        const uRe = re[a];
        const uIm = im[a];
        const vRe = re[b] * cRe - im[b] * cIm;
        const vIm = re[b] * cIm + im[b] * cRe;
        re[a] = uRe + vRe;
        im[a] = uIm + vIm;
        re[b] = uRe - vRe;
        im[b] = uIm - vIm;
        const nRe = cRe * wRe - cIm * wIm;
        cIm = cRe * wIm + cIm * wRe;
        cRe = nRe;
      }
    }
  }
}

function pearson(xs, ys) {
  const n = xs.length;
  let mx = 0;
  let my = 0;
  for (let i = 0; i < n; i += 1) {
    mx += xs[i];
    my += ys[i];
  }
  mx /= n;
  my /= n;
  let num = 0;
  let dx = 0;
  let dy = 0;
  for (let i = 0; i < n; i += 1) {
    const a = xs[i] - mx;
    const b = ys[i] - my;
    num += a * b;
    dx += a * a;
    dy += b * b;
  }
  if (dx === 0 || dy === 0) return 0;
  return num / Math.sqrt(dx * dy);
}

/**
 * Estimate tempo from an onset envelope's autocorrelation.
 * @returns {{bpm:number, confidence:number}|null} bpm in [40,200]; confidence
 *   is the normalized autocorrelation peak in (0,1].
 */
export function estimateBpm(samples, sampleRate) {
  if (
    !samples ||
    !Number.isFinite(sampleRate) ||
    sampleRate <= 0 ||
    samples.length < sampleRate * MIN_ANALYSIS_SECONDS
  ) {
    return null;
  }
  const hop = Math.max(1, Math.round(sampleRate * ENVELOPE_HOP_S));
  const frames = Math.floor(samples.length / hop);
  // Positive spectral-flux-style onset envelope from short-window energy.
  const onset = new Float64Array(frames);
  let prevEnergy = 0;
  for (let f = 0; f < frames; f += 1) {
    const start = f * hop;
    const end = Math.min(start + hop, samples.length);
    let energy = 0;
    for (let i = start; i < end; i += 1) energy += samples[i] * samples[i];
    energy /= end - start;
    if (f > 0) onset[f] = Math.max(0, energy - prevEnergy);
    prevEnergy = energy;
  }
  // Light 3-frame box blur: razor-sharp onset spikes punish fractional
  // periods (e.g. 180 BPM = 66.67 hops) at the fundamental while their
  // on-grid half-time multiples correlate perfectly and steal the peak.
  const smooth = new Float64Array(frames);
  for (let f = 0; f < frames; f += 1) {
    let acc = 0;
    let count = 0;
    for (let k = -1; k <= 1; k += 1) {
      const j = f + k;
      if (j >= 0 && j < frames) {
        acc += onset[j];
        count += 1;
      }
    }
    smooth[f] = acc / count;
  }
  // Mean-center, then 4x-upsample with linear interpolation so
  // parabolically-refined peaks land on sub-lag tempos precisely.
  let mean = 0;
  for (let f = 0; f < frames; f += 1) mean += smooth[f];
  mean /= frames;
  const UPSAMPLE = 4;
  const upLen = frames * UPSAMPLE;
  const up = new Float64Array(upLen);
  for (let f = 0; f < frames; f += 1) {
    const v = smooth[f] - mean;
    const vNext = f + 1 < frames ? smooth[f + 1] - mean : 0;
    for (let k = 0; k < UPSAMPLE; k += 1) {
      up[f * UPSAMPLE + k] = v + ((vNext - v) * k) / UPSAMPLE;
    }
  }
  let energy0 = 0;
  for (let f = 0; f < upLen; f += 1) energy0 += up[f] * up[f];
  if (energy0 <= 0) return null;
  const envRate = (sampleRate / hop) * UPSAMPLE;
  const minLag = Math.max(2, Math.round(envRate / (BPM_MAX / 60)));
  const maxLag = Math.min(upLen - 1, Math.round(envRate / (BPM_MIN / 60)));
  if (maxLag <= minLag) return null;
  // Autocorrelate and store per-lag correlations. Peak SELECTION happens
  // on parabolically-refined peaks (see below): raw integer lags quantize
  // tempos like 180 BPM while their half-time multiples land exactly
  // on-grid and would otherwise steal the win.
  const corrs = new Float64Array(maxLag + 1);
  let maxCorr = 0;
  for (let lag = minLag; lag <= maxLag; lag += 1) {
    let acc = 0;
    for (let f = 0; f + lag < upLen; f += 1) acc += up[f] * up[f + lag];
    const corr = acc / energy0;
    corrs[lag] = corr;
    if (corr > maxCorr) maxCorr = corr;
  }
  if (maxCorr <= 0) return null;
  // Refine every local maximum with parabolic interpolation (sub-lag
  // precision for both lag and peak height).
  const peaks = [];
  for (let lag = minLag + 1; lag < maxLag; lag += 1) {
    const y0 = corrs[lag - 1];
    const y1 = corrs[lag];
    const y2 = corrs[lag + 1];
    if (!(y1 > y0 && y1 >= y2 && y1 > 0)) continue;
    const denom = y0 - 2 * y1 + y2;
    let refinedLag = lag;
    let height = y1;
    if (denom !== 0) {
      const off = 0.5 * ((y0 - y2) / denom);
      if (Math.abs(off) <= 1) {
        refinedLag = lag + off;
        height = y1 - ((y0 - y2) * (y0 - y2)) / (8 * denom);
      }
    }
    peaks.push({ lag: refinedLag, height });
  }
  if (peaks.length === 0) return null;
  const tallest = Math.max(...peaks.map((p) => p.height));
  // Octave disambiguation: autocorrelation peaks at the true lag and its
  // multiples (half/double-time). Take the FASTEST tempo whose refined
  // peak is within striking distance of the tallest — the quickest pulse
  // that still explains the onsets.
  const OCTAVE_KEEP_RATIO = 0.92;
  const candidates = peaks.filter((p) => p.height >= OCTAVE_KEEP_RATIO * tallest);
  candidates.sort((a, b) => a.lag - b.lag);
  const winner = candidates[0];
  return {
    bpm: (60 * envRate) / winner.lag,
    confidence: Math.min(1, Math.max(0, winner.height)),
  };
}

/**
 * Estimate musical key from an averaged FFT chromagram matched against
 * Krumhansl-Schmuckler profiles.
 * @returns {{key:string, mode:"major"|"minor", confidence:number}|null}
 *   confidence is the Pearson correlation of the winning profile in (0,1].
 */
export function estimateKey(samples, sampleRate) {
  if (
    !samples ||
    !Number.isFinite(sampleRate) ||
    sampleRate <= 0 ||
    samples.length < FFT_SIZE
  ) {
    return null;
  }
  const chroma = new Float64Array(12);
  const re = new Float64Array(FFT_SIZE);
  const im = new Float64Array(FFT_SIZE);
  const binHz = sampleRate / FFT_SIZE;
  let totalEnergy = 0;
  for (let offset = 0; offset + FFT_SIZE <= samples.length; offset += FFT_HOP) {
    for (let i = 0; i < FFT_SIZE; i += 1) {
      const hann = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (FFT_SIZE - 1)));
      re[i] = samples[offset + i] * hann;
      im[i] = 0;
    }
    fftRadix2(re, im);
    for (let k = 1; k < FFT_SIZE / 2; k += 1) {
      const freq = k * binHz;
      if (freq < CHROMA_MIN_HZ || freq > CHROMA_MAX_HZ) continue;
      const mag = Math.sqrt(re[k] * re[k] + im[k] * im[k]);
      if (mag <= 0) continue;
      const midi = Math.round(
        MIDI_A4 + 12 * (Math.log2(freq / REFERENCE_A_HZ)),
      );
      const pc = ((midi % 12) + 12) % 12;
      chroma[pc] += mag;
      totalEnergy += mag;
    }
  }
  if (totalEnergy <= 0) return null;
  let best = { key: null, mode: null, confidence: 0 };
  for (let tonic = 0; tonic < 12; tonic += 1) {
    for (const [mode, profile] of [
      ["major", PROFILE_MAJOR],
      ["minor", PROFILE_MINOR],
    ]) {
      const rotated = new Array(12);
      for (let i = 0; i < 12; i += 1) rotated[i] = profile[(i - tonic + 12) % 12];
      const corr = pearson(chroma, rotated);
      if (corr > best.confidence) {
        best = { key: KEY_NAMES[tonic], mode, confidence: corr };
      }
    }
  }
  return best.key === null ? null : best;
}

/**
 * Full analysis pass over decoded mono PCM: BPM + key + duration.
 * @returns {{bpm:number|null, bpmConfidence:number|null,
 *   key:string|null, mode:string|null, keyConfidence:number|null,
 *   duration:number}}
 */
export function analyzeBuffer(samples, sampleRate) {
  const capped = samples.length > sampleRate * ANALYSIS_MAX_SECONDS
    ? samples.slice(0, Math.floor(sampleRate * ANALYSIS_MAX_SECONDS))
    : samples;
  const bpm = estimateBpm(capped, sampleRate);
  const key = estimateKey(capped, sampleRate);
  return {
    bpm: bpm ? bpm.bpm : null,
    bpmConfidence: bpm ? bpm.confidence : null,
    key: key ? key.key : null,
    mode: key ? key.mode : null,
    keyConfidence: key ? key.confidence : null,
    duration: samples.length / sampleRate,
  };
}

/**
 * Musical compatibility between two analysis results, 0 (unrelated) to 1
 * (tight match). BPM matching is half/double-time aware; key matching
 * rewards same key, relative major/minor, and fifth relations.
 */
export function analysisSimilarity(a, b) {
  if (!a || !b) return 0;
  let bpmScore = 0;
  if (a.bpm != null && b.bpm != null && a.bpm > 0 && b.bpm > 0) {
    const ratios = [a.bpm / b.bpm, b.bpm / a.bpm];
    const nearest = Math.min(
      ...ratios.map((r) => Math.abs(r - Math.round(r))),
    );
    const diff = Math.min(
      Math.abs(a.bpm - b.bpm),
      Math.abs(a.bpm - 2 * b.bpm),
      Math.abs(2 * a.bpm - b.bpm),
    );
    bpmScore = nearest < 0.03
      ? Math.max(0, 1 - diff / SIMILARITY_BPM_TOLERANCE)
      : 0;
  }
  let keyScore = 0;
  if (a.key != null && b.key != null) {
    const ai = KEY_NAMES.indexOf(a.key);
    const bi = KEY_NAMES.indexOf(b.key);
    const rel = (bi - ai + 12) % 12;
    if (ai === bi && a.mode === b.mode) keyScore = 1;
    else if (ai === bi) keyScore = 0.7; // parallel major/minor
    else if ((a.mode === "major" && b.mode === "minor" && rel === 9) ||
      (a.mode === "minor" && b.mode === "major" && rel === 3)) {
      keyScore = 0.85; // relative major/minor
    } else if (rel === 7 || rel === 5) keyScore = 0.5; // fifth
  }
  return 0.5 * bpmScore + 0.5 * keyScore;
}

// ── Browser plumbing (fetch + AudioContext), kept injectable for tests ────

/**
 * Fetch a preview URL and decode it to capped mono PCM.
 * Throws on network failure, decode failure, or missing browser audio APIs.
 */
export async function decodePreview(url, deps = {}) {
  const fetchImpl = deps.fetch ?? globalThis.fetch?.bind(globalThis);
  const AC = deps.AudioContext ??
    globalThis.AudioContext ??
    globalThis.webkitAudioContext;
  if (!fetchImpl || !AC) throw new Error("audio-analysis-unavailable");
  const res = await fetchImpl(url);
  if (!res.ok) throw new Error(`preview-fetch-${res.status}`);
  const raw = await res.arrayBuffer();
  const ctx = new AC();
  try {
    const audio = await ctx.decodeAudioData(raw);
    const len = Math.min(
      audio.length,
      Math.floor(audio.sampleRate * ANALYSIS_MAX_SECONDS),
    );
    const mono = new Float32Array(len);
    for (let ch = 0; ch < audio.numberOfChannels; ch += 1) {
      const data = audio.getChannelData(ch).subarray(0, len);
      for (let i = 0; i < len; i += 1) mono[i] += data[i] / audio.numberOfChannels;
    }
    return { samples: mono, sampleRate: audio.sampleRate, duration: audio.duration };
  } finally {
    if (typeof ctx.close === "function") await ctx.close();
  }
}

/**
 * End-to-end: fetch a preview URL, decode, and analyze it.
 */
export async function analyzePreviewUrl(url, deps = {}) {
  const { samples, sampleRate } = await decodePreview(url, deps);
  return analyzeBuffer(samples, sampleRate);
}

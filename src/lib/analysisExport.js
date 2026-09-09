/**
 * DOGS Sampler — analysis export for DAW workflows (roadmap #5, slice 2).
 *
 * Takes a track's on-device analysis (BPM, musical key, optional
 * slice/loop markers and similarity data) and produces two artifacts:
 *
 *  1. A JSON sidecar (`dogs-sampler/analysis-sidecar@1`, documented in
 *     docs/ANALYSIS-EXPORT.md) — the full record, machine-readable.
 *  2. A markers CSV (`bar,beat,time_ms,label,kind`) — hand-editable and
 *     importable into DAW workflows (Ableton warping reference, slicers,
 *     marker lists).
 *
 * Everything here is pure: no DOM, no fs, no network. Node (the `sampler`
 * CLI) and the browser (SearchView's Export buttons) share it verbatim.
 * Slices/loops are optional input; when no explicit slices exist, markers
 * are derived from the detected BPM as a 4/4 bar grid so the CSV is never
 * empty when tempo was detected.
 */

// ── Hoisted constants ────────────────────────────────────────────────────
const EXPORT_SCHEMA = "dogs-sampler/analysis-sidecar@1";
const CSV_HEADER = ["bar", "beat", "time_ms", "label", "kind"];
const BEATS_PER_BAR = 4;
const BEAT_UNIT = 4;
const MS_PER_MINUTE = 60000;
const MAX_BAR_MARKERS = 4096; // sanity cap for very long durations
const MARKER_KIND_BAR = "bar";
const MARKER_KIND_SLICE = "slice";
const MARKER_KIND_LOOP_START = "loop-start";
const MARKER_KIND_LOOP_END = "loop-end";

function isFiniteNumber(v) {
  return typeof v === "number" && Number.isFinite(v);
}

function round2(v) {
  return Math.round(v * 100) / 100;
}

function barMsFor(bpm) {
  return (MS_PER_MINUTE / bpm) * BEATS_PER_BAR;
}

/**
 * Validate an analysis object and normalize the export inputs.
 * @throws {Error} with a `no-analysis`-style message when the input is
 *   missing or unusable — the CLI and UI both surface this verbatim.
 * @returns {{ trackId: string, title: string|null, provider: string|null,
 *   analysis: object }}
 */
export function requireExportInput(input) {
  if (!input || typeof input !== "object") {
    throw new Error("no-analysis: expected an object with analysis data");
  }
  const analysis = input.analysis ?? input;
  if (!analysis || typeof analysis !== "object") {
    throw new Error("no-analysis: no analysis object found");
  }
  const hasAnything =
    analysis.bpm != null ||
    analysis.key != null ||
    (Array.isArray(analysis.slices) && analysis.slices.length > 0) ||
    (Array.isArray(analysis.loops) && analysis.loops.length > 0);
  if (!hasAnything) {
    throw new Error(
      "no-analysis: analysis has no BPM, key, slices, or loops to export",
    );
  }
  const track = input.track ?? {};
  const trackId =
    typeof track.id === "string" && track.id
      ? track.id
      : typeof input.trackId === "string" && input.trackId
        ? input.trackId
        : "unknown";
  return {
    trackId,
    title: typeof track.title === "string" ? track.title : null,
    provider: typeof track.provider === "string" ? track.provider : null,
    previewUrl:
      typeof track.previewUrl === "string" ? track.previewUrl : null,
    license: typeof track.license === "string" ? track.license : null,
    analysis,
  };
}

/**
 * Derive export markers from an analysis: a 4/4 bar grid off the detected
 * BPM plus any explicit slices/loops.
 * @returns {{ bar: number|null, beat: number|null, timeMs: number,
 *   label: string, kind: string }[]}
 */
export function buildMarkers(analysis) {
  const markers = [];
  const bpm = isFiniteNumber(analysis.bpm) && analysis.bpm > 0
    ? analysis.bpm
    : null;
  const durationMs = isFiniteNumber(analysis.durationSeconds) &&
    analysis.durationSeconds > 0
    ? analysis.durationSeconds * 1000
    : null;
  if (bpm !== null && durationMs !== null) {
    const barMs = barMsFor(bpm);
    const beatMs = MS_PER_MINUTE / bpm;
    const barCount = Math.min(
      MAX_BAR_MARKERS,
      Math.max(1, Math.ceil(durationMs / barMs)),
    );
    for (let bar = 1; bar <= barCount; bar += 1) {
      markers.push({
        bar,
        beat: 1,
        timeMs: Math.round((bar - 1) * barMs),
        label: `Bar ${bar}`,
        kind: MARKER_KIND_BAR,
      });
    }
    const placeSlice = (timeMs, label, kind) => {
      const bar = Math.floor(timeMs / barMs) + 1;
      const beat = Math.floor((timeMs % barMs) / beatMs) + 1;
      markers.push({
        bar,
        beat,
        timeMs: Math.round(timeMs),
        label,
        kind,
      });
    };
    for (const slice of analysis.slices ?? []) {
      if (!isFiniteNumber(slice.timeMs)) continue;
      placeSlice(
        Math.max(0, slice.timeMs),
        typeof slice.label === "string" && slice.label ? slice.label : "Slice",
        MARKER_KIND_SLICE,
      );
    }
    for (const loop of analysis.loops ?? []) {
      if (!isFiniteNumber(loop.startMs) || !isFiniteNumber(loop.endMs)) continue;
      const label =
        typeof loop.label === "string" && loop.label ? loop.label : "Loop";
      placeSlice(Math.max(0, loop.startMs), `${label} (start)`, MARKER_KIND_LOOP_START);
      placeSlice(Math.max(0, loop.endMs), `${label} (end)`, MARKER_KIND_LOOP_END);
    }
  } else {
    // No tempo grid possible — emit raw slices/loops without bar/beat.
    for (const slice of analysis.slices ?? []) {
      if (!isFiniteNumber(slice.timeMs)) continue;
      markers.push({
        bar: null,
        beat: null,
        timeMs: Math.round(slice.timeMs),
        label:
          typeof slice.label === "string" && slice.label ? slice.label : "Slice",
        kind: MARKER_KIND_SLICE,
      });
    }
    for (const loop of analysis.loops ?? []) {
      if (!isFiniteNumber(loop.startMs) || !isFiniteNumber(loop.endMs)) continue;
      const label =
        typeof loop.label === "string" && loop.label ? loop.label : "Loop";
      markers.push({
        bar: null,
        beat: null,
        timeMs: Math.round(loop.startMs),
        label: `${label} (start)`,
        kind: MARKER_KIND_LOOP_START,
      });
      markers.push({
        bar: null,
        beat: null,
        timeMs: Math.round(loop.endMs),
        label: `${label} (end)`,
        kind: MARKER_KIND_LOOP_END,
      });
    }
  }
  markers.sort((a, b) => a.timeMs - b.timeMs || (a.bar ?? 0) - (b.bar ?? 0));
  return markers;
}

/**
 * Build the full sidecar payload for a track + analysis.
 * @returns {object} conforming to `dogs-sampler/analysis-sidecar@1`
 */
export function buildSidecar(input) {
  const { trackId, title, provider, previewUrl, license, analysis } =
    requireExportInput(input);
  const cleanSlice = (s) => ({
    timeMs: Math.round(s.timeMs),
    label: typeof s.label === "string" ? s.label : "Slice",
  });
  const cleanLoop = (l) => ({
    startMs: Math.round(l.startMs),
    endMs: Math.round(l.endMs),
    label: typeof l.label === "string" ? l.label : "Loop",
  });
  return {
    schema: EXPORT_SCHEMA,
    exportedAt: new Date().toISOString(),
    track: {
      id: trackId,
      title,
      provider,
      previewUrl,
      license,
    },
    analysis: {
      bpm: isFiniteNumber(analysis.bpm) ? round2(analysis.bpm) : null,
      bpmConfidence: isFiniteNumber(analysis.bpmConfidence)
        ? round2(analysis.bpmConfidence)
        : null,
      key: typeof analysis.key === "string" ? analysis.key : null,
      mode: typeof analysis.mode === "string" ? analysis.mode : null,
      keyConfidence: isFiniteNumber(analysis.keyConfidence)
        ? round2(analysis.keyConfidence)
        : null,
      durationSeconds: isFiniteNumber(analysis.durationSeconds)
        ? round2(analysis.durationSeconds)
        : isFiniteNumber(analysis.duration)
          ? round2(analysis.duration)
          : null,
      timeSignature: { beats: BEATS_PER_BAR, beatUnit: BEAT_UNIT },
      slices: (analysis.slices ?? [])
        .filter((s) => s && isFiniteNumber(s.timeMs))
        .map(cleanSlice),
      loops: (analysis.loops ?? [])
        .filter((l) => l && isFiniteNumber(l.startMs) && isFiniteNumber(l.endMs))
        .map(cleanLoop),
      similarity: analysis.similarity ?? null,
    },
    markers: buildMarkers({
      bpm: analysis.bpm,
      durationSeconds: isFiniteNumber(analysis.durationSeconds)
        ? analysis.durationSeconds
        : analysis.duration,
      slices: (analysis.slices ?? [])
        .filter((s) => s && isFiniteNumber(s.timeMs))
        .map(cleanSlice),
      loops: (analysis.loops ?? [])
        .filter((l) => l && isFiniteNumber(l.startMs) && isFiniteNumber(l.endMs))
        .map(cleanLoop),
    }),
  };
}

/** Serialize a sidecar payload to pretty JSON text. */
export function serializeSidecar(payload) {
  return JSON.stringify(payload, null, 2) + "\n";
}

function csvCell(value) {
  const text = value === null || value === undefined ? "" : String(value);
  if (/[",\n\r]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

/**
 * Serialize markers to RFC-4180 CSV: `bar,beat,time_ms,label,kind`.
 * Labels containing commas, quotes, or newlines are quoted and escaped.
 */
export function serializeMarkersCsv(markers) {
  const lines = [CSV_HEADER.join(",")];
  for (const m of markers) {
    lines.push(
      [m.bar, m.beat, m.timeMs, m.label, m.kind].map(csvCell).join(","),
    );
  }
  return lines.join("\n") + "\n";
}

/** Parse + validate a sidecar JSON string. Throws a clean Error on failure. */
export function parseSidecar(text) {
  let payload;
  try {
    payload = JSON.parse(text);
  } catch {
    throw new Error("invalid-sidecar: not valid JSON");
  }
  if (!payload || payload.schema !== EXPORT_SCHEMA) {
    throw new Error(
      `invalid-sidecar: expected schema "${EXPORT_SCHEMA}"`,
    );
  }
  if (!Array.isArray(payload.markers)) {
    throw new Error("invalid-sidecar: missing markers array");
  }
  return payload;
}

/**
 * Parse a markers CSV back into marker objects (round-trip inverse of
 * serializeMarkersCsv).
 */
export function parseMarkersCsv(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;
  let i = 0;
  const pushCell = () => {
    row.push(cell);
    cell = "";
  };
  while (i < text.length) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i += 2;
          continue;
        }
        quoted = false;
        i += 1;
        continue;
      }
      cell += ch;
      i += 1;
      continue;
    }
    if (ch === '"') {
      quoted = true;
      i += 1;
      continue;
    }
    if (ch === ",") {
      pushCell();
      i += 1;
      continue;
    }
    if (ch === "\n" || ch === "\r") {
      pushCell();
      rows.push(row);
      row = [];
      if (ch === "\r" && text[i + 1] === "\n") i += 2;
      else i += 1;
      continue;
    }
    cell += ch;
    i += 1;
  }
  pushCell();
  if (row.length > 1 || row[0] !== "") rows.push(row);
  if (rows.length === 0) throw new Error("invalid-csv: empty input");
  const header = rows[0].map((h) => h.trim());
  for (let h = 0; h < CSV_HEADER.length; h += 1) {
    if (header[h] !== CSV_HEADER[h]) {
      throw new Error(
        `invalid-csv: expected header "${CSV_HEADER.join(",")}"`,
      );
    }
  }
  return rows.slice(1).map((cols, idx) => {
    const num = (v) => (v === "" ? null : Number(v));
    const bar = num(cols[0]);
    const beat = num(cols[1]);
    const timeMs = num(cols[2]);
    if (!Number.isFinite(timeMs)) {
      throw new Error(`invalid-csv: row ${idx + 2} has bad time_ms`);
    }
    return {
      bar: Number.isFinite(bar) ? bar : null,
      beat: Number.isFinite(beat) ? beat : null,
      timeMs,
      label: cols[3] ?? "",
      kind: cols[4] ?? "",
    };
  });
}

export { EXPORT_SCHEMA, CSV_HEADER };

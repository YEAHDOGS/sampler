# Analysis export — Ableton / DAW handoff

`src/lib/analysisExport.js` turns a track's on-device analysis into files you
can drop into a DAW session. Two artifacts:

## 1. JSON sidecar — `dogs-sampler/analysis-sidecar@1`

The full record. Written by `buildSidecar(input)` / `serializeSidecar()`.

```json
{
  "schema": "dogs-sampler/analysis-sidecar@1",
  "exportedAt": "2026-09-09T16:30:00.000Z",
  "track": {
    "id": "local:kick",
    "title": "Fixture Kick",
    "provider": "local",
    "previewUrl": "/fixtures/kick.wav",
    "license": "CC0 1.0 — synthesized fixture, bundled with DOGS Sampler"
  },
  "analysis": {
    "bpm": 120.0,
    "bpmConfidence": 0.98,
    "key": "C",
    "mode": "major",
    "keyConfidence": 0.91,
    "durationSeconds": 0.35,
    "timeSignature": { "beats": 4, "beatUnit": 4 },
    "slices": [{ "timeMs": 0, "label": "hit" }],
    "loops": [{ "startMs": 0, "endMs": 2000, "label": "chorus" }],
    "similarity": null
  },
  "markers": [
    { "bar": 1, "beat": 1, "timeMs": 0, "label": "Bar 1", "kind": "bar" }
  ]
}
```

Field rules:

- All numeric analysis fields are `null` when detection failed — never
  invented. `null` means "unknown".
- `durationSeconds` also accepts the `duration` alias produced by
  `analyzeBuffer()` — same seconds.
- `timeSignature` is always 4/4; the bar grid in `markers` assumes it.
- `slices` are auto-detected transients: `analyzeBuffer()` runs
  `detectSlicePoints()` (adaptive peak-picking on the onset envelope, 50 ms
  refractory merge) and labels them `Slice 1…N`; exported markers place them
  on the bar grid off the detected BPM as `kind="slice"` rows. `loops`
  remain passthrough (validated, not invented).
- `similarity` is a passthrough slot for `analysisSimilarity()`-style
  output; `null` today.

## 2. Markers CSV

Header: `bar,beat,time_ms,label,kind`

```csv
bar,beat,time_ms,label,kind
1,1,0,Bar 1,bar
2,1,2000,Bar 2,bar
1,3,1000,"break, ""chopped""",slice
```

- `kind` is one of `bar`, `slice`, `loop-start`, `loop-end`.
- When BPM was detected, every marker also carries `bar`/`beat` from the
  4/4 grid (`bar = floor(t / barMs) + 1`, `beat` likewise within the bar).
- When no BPM is known, `bar`/`beat` are empty and the CSV still carries
  raw `time_ms` slice/loop points.
- Escaping is RFC-4180: a cell containing `,` `"` or a newline is
  double-quoted, and inner quotes are doubled. `parseMarkersCsv()` is the
  exact inverse — the round trip is covered by `test/analysisExport.test.js`.

## Bar grid derivation

`buildMarkers()` emits one `bar` marker per bar of detected duration,
capped at 4096 markers, labeled `Bar N` starting at beat 1. At 120 BPM one
bar is 2000 ms, so a 4-second loop yields bars at 0 and 2000 ms. Slices and
loops keep their absolute `timeMs` and are slotted into the grid — Ableton
users can read `time_ms` directly against the session timeline after
warping to the detected BPM.

## CLI

```
sampler export <track-id> --format json|csv --out FILE [--input FILE.json]
```

`<track-id>` resolves to an analysis JSON file: `--input`, else
`./<track-id>.analysis.json`, else `./<track-id>.json`. Missing analysis
exits 1 with a clean `no-analysis: ...` message. `--out` omitted writes to
stdout. See `bin/sampler.js`.

## UI

In `SearchView`, once a card's analysis completes, two Export buttons
(`.json` / `.csv`) sit next to the BPM/key chips and download the files via
a blob URL — no server, no persistence. CLI covers batch/offline use.

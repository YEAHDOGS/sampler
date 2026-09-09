/**
 * DOGS Sampler — smoke tests for analysis export (roadmap #5, slice 2).
 *
 * Runs with Node's built-in test runner, no dependencies required:
 *
 *   npm run test:smoke   # node --test test/
 *
 * Covers: JSON sidecar schema + round trip, CSV marker escaping of hostile
 * labels, bar/beat grid derivation from BPM, missing-analysis clean errors,
 * and the `sampler export` CLI end to end.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { writeFileSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  EXPORT_SCHEMA,
  buildSidecar,
  buildMarkers,
  serializeSidecar,
  serializeMarkersCsv,
  parseSidecar,
  parseMarkersCsv,
  requireExportInput,
} from '../src/lib/analysisExport.js';

const here = dirname(fileURLToPath(import.meta.url));
const REPO = join(here, '..');
const CLI = join(REPO, 'bin', 'sampler.js');

/** Representative fixture analysis: 120 BPM, C major, 4 s, hostile labels. */
function fixtureInput() {
  return {
    trackId: 'local:kick',
    track: {
      id: 'local:kick',
      title: 'Fixture Kick',
      provider: 'local',
      previewUrl: '/fixtures/kick.wav',
      license: 'CC0',
    },
    analysis: {
      bpm: 120,
      bpmConfidence: 0.98,
      key: 'C',
      mode: 'major',
      keyConfidence: 0.91,
      duration: 4, // analyzeBuffer() shape: `duration` in seconds
      slices: [
        { timeMs: 1000, label: 'break, "chopped"\nline2' },
        { timeMs: 2500, label: 'wobble,üñí' },
      ],
      loops: [{ startMs: 0, endMs: 2000, label: 'intro' }],
    },
  };
}

describe('buildSidecar', () => {
  it('emits the documented schema with track + analysis', () => {
    const p = buildSidecar(fixtureInput());
    assert.equal(p.schema, EXPORT_SCHEMA);
    assert.ok(Date.parse(p.exportedAt), 'exportedAt must parse');
    assert.equal(p.track.id, 'local:kick');
    assert.equal(p.track.title, 'Fixture Kick');
    assert.equal(p.analysis.bpm, 120);
    assert.equal(p.analysis.key, 'C');
    assert.equal(p.analysis.mode, 'major');
    assert.equal(p.analysis.durationSeconds, 4);
    assert.deepEqual(p.analysis.timeSignature, { beats: 4, beatUnit: 4 });
  });

  it('keeps nulls null instead of inventing values', () => {
    const p = buildSidecar({
      trackId: 'x',
      analysis: { bpm: null, key: 'C', mode: null, keyConfidence: null, duration: 3 },
    });
    assert.equal(p.analysis.bpm, null);
    assert.equal(p.analysis.mode, null);
    assert.equal(p.analysis.keyConfidence, null);
    assert.equal(p.analysis.key, 'C');
  });
});

describe('buildMarkers', () => {
  it('derives a 4/4 bar grid from BPM (120 BPM → bar 2 at 2000 ms)', () => {
    const markers = buildMarkers({ bpm: 120, durationSeconds: 4 });
    const bars = markers.filter((m) => m.kind === 'bar');
    assert.deepEqual(
      bars.map((m) => [m.bar, m.timeMs]),
      [[1, 0], [2, 2000]],
    );
  });

  it('slots slices into bar/beat (slice at 1000 ms @120 = bar 1 beat 3)', () => {
    const markers = buildMarkers({
      bpm: 120,
      durationSeconds: 4,
      slices: [{ timeMs: 1000, label: 'hit' }],
    });
    const hit = markers.find((m) => m.kind === 'slice');
    assert.deepEqual([hit.bar, hit.beat, hit.timeMs], [1, 3, 1000]);
  });

  it('expands loops into start/end markers', () => {
    const markers = buildMarkers({
      bpm: 120,
      durationSeconds: 4,
      loops: [{ startMs: 0, endMs: 2000, label: 'intro' }],
    });
    const kinds = markers.map((m) => m.kind).sort();
    assert.ok(kinds.includes('loop-start'));
    assert.ok(kinds.includes('loop-end'));
  });

  it('falls back to raw time_ms without BPM (bar/beat empty)', () => {
    const markers = buildMarkers({
      slices: [{ timeMs: 500, label: 'hit' }],
    });
    assert.equal(markers.length, 1);
    assert.equal(markers[0].bar, null);
    assert.equal(markers[0].beat, null);
    assert.equal(markers[0].timeMs, 500);
  });
});

describe('round trip', () => {
  it('sidecar JSON survives parse → identical markers', () => {
    const payload = buildSidecar(fixtureInput());
    const back = parseSidecar(serializeSidecar(payload));
    assert.equal(back.schema, EXPORT_SCHEMA);
    assert.deepEqual(back.markers, payload.markers);
    assert.deepEqual(back.analysis, payload.analysis);
  });

  it('CSV survives parse → identical markers', () => {
    const markers = buildMarkers(fixtureInput().analysis);
    const back = parseMarkersCsv(serializeMarkersCsv(markers));
    assert.deepEqual(back, markers);
  });

  it('rejects a sidecar with the wrong schema', () => {
    assert.throws(
      () => parseSidecar('{"schema":"nope","markers":[]}'),
      /invalid-sidecar/,
    );
    assert.throws(() => parseSidecar('not json'), /invalid-sidecar/);
  });
});

describe('CSV escaping', () => {
  it('quotes and escapes hostile labels (commas, quotes, newlines, unicode)', () => {
    const markers = buildMarkers(fixtureInput().analysis);
    const csv = serializeMarkersCsv(markers);
    const back = parseMarkersCsv(csv);
    const labels = back.map((m) => m.label);
    assert.ok(labels.includes('break, "chopped"\nline2'));
    assert.ok(labels.includes('wobble,üñí'));
    // raw CSV must quote the hostile cells
    assert.ok(csv.includes('"break, ""chopped""\nline2"'));
  });

  it('rejects a CSV with a wrong header', () => {
    assert.throws(
      () => parseMarkersCsv('a,b,c\n1,2,3\n'),
      /invalid-csv/,
    );
  });
});

describe('requireExportInput', () => {
  it('fails clean on null / empty / useless analysis', () => {
    for (const bad of [null, undefined, {}, { analysis: {} }, { analysis: { bpm: null } }]) {
      assert.throws(() => requireExportInput(bad), /no-analysis/, JSON.stringify(bad));
    }
  });

  it('accepts a bare analysis object without a track wrapper', () => {
    const r = requireExportInput({ bpm: 120, key: 'C', duration: 4 });
    assert.equal(r.trackId, 'unknown');
    assert.equal(r.analysis.bpm, 120);
  });
});

// ── CLI end to end ───────────────────────────────────────────────────────────

describe('sampler export CLI', () => {
  function runCli(args, cwd) {
    return spawnSync(process.execPath, [CLI, ...args], {
      cwd,
      encoding: 'utf8',
      timeout: 15000,
    });
  }

  it('exports JSON and CSV from an analysis file', () => {
    const dir = mkdtempSync(join(tmpdir(), 'sampler-export-'));
    writeFileSync(join(dir, 'kick.analysis.json'), JSON.stringify(fixtureInput()));
    const json = runCli(['export', 'kick', '--format', 'json', '--out', 'kick.sampler.json'], dir);
    assert.equal(json.status, 0, json.stderr);
    const csv = runCli(['export', 'kick', '--format', 'csv', '--out', 'kick.markers.csv'], dir);
    assert.equal(csv.status, 0, csv.stderr);
    const payload = parseSidecar(
      readFileSync(join(dir, 'kick.sampler.json'), 'utf8'),
    );
    assert.equal(payload.schema, EXPORT_SCHEMA);
    const markers = parseMarkersCsv(
      readFileSync(join(dir, 'kick.markers.csv'), 'utf8'),
    );
    assert.ok(markers.length > 0);
  });

  it('defaults to JSON when --format is omitted', () => {
    const dir = mkdtempSync(join(tmpdir(), 'sampler-export-'));
    writeFileSync(join(dir, 'x.json'), JSON.stringify(fixtureInput()));
    const r = runCli(['export', 'x', '--out', 'x.out'], dir);
    assert.equal(r.status, 0, r.stderr);
    assert.equal(parseSidecar(readFileSync(join(dir, 'x.out'), 'utf8')).schema, EXPORT_SCHEMA);
  });

  it('missing analysis fails with a clean no-analysis error', () => {
    const dir = mkdtempSync(join(tmpdir(), 'sampler-export-'));
    const r = runCli(['export', 'ghost', '--out', 'ghost.json'], dir);
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /no-analysis/);
  });

  it('rejects an unknown format', () => {
    const dir = mkdtempSync(join(tmpdir(), 'sampler-export-'));
    writeFileSync(join(dir, 'x.json'), JSON.stringify(fixtureInput()));
    const r = runCli(['export', 'x', '--format', 'xml', '--out', 'x.out'], dir);
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /unknown format/i);
  });

  it('prints usage on no args', () => {
    const r = runCli([], tmpdir());
    assert.notEqual(r.status, 0);
    assert.match(r.stderr + r.stdout, /usage/i);
  });
});

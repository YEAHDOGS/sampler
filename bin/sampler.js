#!/usr/bin/env node
/**
 * DOGS Sampler — CLI.
 *
 *   sampler export <track-id> --format json|csv --out FILE [--input FILE.json]
 *
 * Exports a track's on-device analysis for DAW workflows: a JSON sidecar
 * (`dogs-sampler/analysis-sidecar@1`, see docs/ANALYSIS-EXPORT.md) or a
 * markers CSV (`bar,beat,time_ms,label,kind`).
 *
 * The analysis record is read from a JSON file: `--input`, else
 * `./<track-id>.analysis.json`, else `./<track-id>.json`. That file is the
 * same shape the UI's Export buttons download (or any object with an
 * `analysis` key holding BPM/key/slices/loops). Missing analysis exits 1
 * with a clean `no-analysis: ...` message on stderr.
 *
 * Zero dependencies; shares src/lib/analysisExport.js with the browser UI.
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  buildSidecar,
  serializeSidecar,
  serializeMarkersCsv,
} from '../src/lib/analysisExport.js';

// ── Hoisted constants ────────────────────────────────────────────────────
const FORMAT_JSON = 'json';
const FORMAT_CSV = 'csv';
const SUPPORTED_FORMATS = [FORMAT_JSON, FORMAT_CSV];
const EXIT_OK = 0;
const EXIT_USAGE = 1;
const EXIT_FAILED = 2;

function usage() {
  return [
    'usage: sampler export <track-id> --format json|csv --out FILE [--input FILE.json]',
    '',
    '  <track-id>   track whose analysis to export',
    '  --format     json (default) or csv',
    '  --out FILE   write to FILE; omitted writes to stdout',
    '  --input FILE read analysis JSON from FILE instead of <track-id>.analysis.json',
    '',
    'examples:',
    '  sampler export local:kick --format json --out kick.sampler.json',
    '  sampler export local:kick --format csv --out kick.markers.csv',
  ].join('\n');
}

function fail(message, code = EXIT_FAILED) {
  process.stderr.write(`sampler: ${message}\n`);
  process.exit(code);
}

function parseArgs(argv) {
  const positional = [];
  const flags = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg.startsWith('--')) {
      const eq = arg.indexOf('=');
      if (eq !== -1) {
        flags[arg.slice(2, eq)] = arg.slice(eq + 1);
      } else {
        flags[arg.slice(2)] = argv[i + 1] && !argv[i + 1].startsWith('--')
          ? argv[i + 1]
          : true;
        if (flags[arg.slice(2)] !== true) i += 1;
      }
    } else {
      positional.push(arg);
    }
  }
  return { positional, flags };
}

function resolveInputPath(trackId, explicit) {
  if (explicit) return { path: resolve(explicit), tried: [explicit] };
  const candidates = [
    `${trackId}.analysis.json`,
    `${trackId}.json`,
  ];
  for (const c of candidates) {
    if (existsSync(resolve(c))) return { path: resolve(c), tried: candidates };
  }
  return { path: null, tried: candidates };
}

function cmdExport(positional, flags) {
  const trackId = positional[0];
  if (!trackId) fail('export needs a <track-id>\n' + usage(), EXIT_USAGE);
  const format = String(flags.format ?? FORMAT_JSON).toLowerCase();
  if (!SUPPORTED_FORMATS.includes(format)) {
    fail(`unknown format "${format}" — use json or csv`);
  }
  const { path: inputPath, tried } = resolveInputPath(
    trackId,
    typeof flags.input === 'string' ? flags.input : null,
  );
  if (!inputPath) {
    fail(
      `no-analysis: no analysis found for track "${trackId}" ` +
        `— looked for ${tried.map((t) => `./${t}`).join(', ')} ` +
        `(pass --input FILE.json)`,
    );
  }
  let raw;
  try {
    raw = readFileSync(inputPath, 'utf8');
  } catch (err) {
    fail(`could not read ${inputPath}: ${err.message}`);
  }
  let input;
  try {
    input = JSON.parse(raw);
  } catch (err) {
    fail(`invalid input JSON in ${inputPath}: ${err.message}`);
  }
  let payload;
  try {
    payload = buildSidecar(input);
  } catch (err) {
    fail(String(err.message || err));
  }
  const text = format === FORMAT_CSV
    ? serializeMarkersCsv(payload.markers)
    : serializeSidecar(payload);
  const out = typeof flags.out === 'string' ? flags.out : null;
  if (out) {
    try {
      writeFileSync(out, text, 'utf8');
    } catch (err) {
      fail(`could not write ${out}: ${err.message}`);
    }
    process.stderr.write(
      `sampler: wrote ${format} export for "${payload.track.id}" to ${out}\n`,
    );
  } else {
    process.stdout.write(text);
  }
}

function main() {
  const { positional, flags } = parseArgs(process.argv.slice(2));
  if (
    flags.help === true ||
    flags.h === true ||
    positional[0] === 'help' ||
    positional.length === 0
  ) {
    process.stderr.write(usage() + '\n');
    process.exit(positional.length === 0 ? EXIT_USAGE : EXIT_OK);
  }
  const [command, ...rest] = positional;
  if (command === 'export') {
    cmdExport(rest, flags);
    return;
  }
  fail(`unknown command "${command}"\n${usage()}`, EXIT_USAGE);
}

// ── Entry ────────────────────────────────────────────────────────────────
main();

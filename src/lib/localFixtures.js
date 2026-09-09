/**
 * DOGS Sampler — bundled offline fixture samples.
 *
 * Degraded-mode kit: when no API key is configured for any keyed provider
 * (Freesound / Pixabay), the search service appends a LocalFixtureProvider
 * serving these files so the app still has playable samples instead of an
 * empty, erroring page. The WAVs are tiny synthesized drum hits generated
 * offline (16-bit mono 22050 Hz) and live in `public/fixtures/`, so they
 * work with zero network access.
 */

/** Fixture audio files served from `public/fixtures/` (Vite copies verbatim). */
const FIXTURE_DIR = 'fixtures';

/** License label for the bundled fixtures (synthesized in-house). */
const FIXTURE_LICENSE = 'CC0 1.0 — synthesized fixture, bundled with DOGS Sampler';

/** Attribution page: the canonical home of the fixture files. */
const FIXTURE_PAGE_URL = 'https://github.com/YEAHDOGS/sampler/tree/master/public/fixtures';

/**
 * Fixture metadata. `duration` matches the actual WAV length in seconds.
 * @type {{ file: string, title: string, duration: number, tags: string[] }[]}
 */
const LOCAL_FIXTURES = [
  { file: 'kick.wav', title: 'Fixture Kick', duration: 0.35, tags: ['drums', 'kick', 'fixture'] },
  { file: 'snare.wav', title: 'Fixture Snare', duration: 0.25, tags: ['drums', 'snare', 'fixture'] },
  { file: 'hihat.wav', title: 'Fixture Hi-Hat', duration: 0.08, tags: ['drums', 'hi-hat', 'fixture'] },
  { file: 'clap.wav', title: 'Fixture Clap', duration: 0.22, tags: ['drums', 'clap', 'fixture'] },
  { file: 'tom.wav', title: 'Fixture Tom', duration: 0.3, tags: ['drums', 'tom', 'fixture'] },
  { file: 'rim.wav', title: 'Fixture Rimshot', duration: 0.06, tags: ['drums', 'rim', 'fixture'] },
  { file: 'shaker.wav', title: 'Fixture Shaker', duration: 0.18, tags: ['drums', 'shaker', 'fixture'] },
  { file: 'sub.wav', title: 'Fixture Sub Bass', duration: 0.5, tags: ['bass', 'sub', 'fixture'] },
];

/**
 * Resolve the playable URL for a fixture file, honoring the Vite base path
 * so the fixtures work whether the app is served from `/` or a sub-path.
 * @param {string} file Fixture file name, e.g. `kick.wav`.
 * @returns {string}
 */
function fixturePreviewUrl(file) {
  const env = import.meta.env ?? {};
  let base = typeof env.BASE_URL === 'string' ? env.BASE_URL : '/';
  if (!base.endsWith('/')) base += '/';
  return `${base}${FIXTURE_DIR}/${file}`;
}

/**
 * Map the fixture metadata into {@link SampleResult}-shaped records the UI
 * can render exactly like provider hits.
 * @returns {import('./sampleService.js').SampleResult[]}
 */
function localFixtureResults() {
  return LOCAL_FIXTURES.map((fixture) => ({
    id: `local:${fixture.file.replace(/\.wav$/, '')}`,
    provider: 'local',
    title: fixture.title,
    duration: fixture.duration,
    previewUrl: fixturePreviewUrl(fixture.file),
    pageUrl: FIXTURE_PAGE_URL,
    license: FIXTURE_LICENSE,
    tags: [...fixture.tags],
  }));
}

export {
  LOCAL_FIXTURES,
  FIXTURE_DIR,
  FIXTURE_LICENSE,
  FIXTURE_PAGE_URL,
  fixturePreviewUrl,
  localFixtureResults,
};

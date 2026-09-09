# DOGS SAMPLER

Global, royalty-free sample discovery for producers. One search box digs
through **Freesound**, the **Internet Archive audio library**, and
**Pixabay sound effects** — preview instantly, filter by duration and
license, and pull the perfect sample for your next track.

Try queries like: `sick snares` · `grunge claps` · `metal riffs` ·
`thunder lightning` · `stylish flourishes` · `silky pad` ·
`kick ass sound`

## Current state

- **Landing page** (`src/App.svelte`): branded DOGS Sampler hero with EN/ES
  i18n, responsive viewport-matrix layout, Tailwind v4 + SCSS.
- **Search UI** (`src/components/SearchView.svelte`): search box with
  debounce, per-provider result cards with inline `<audio>` previews,
  license + attribution per hit, degraded-mode messaging, and a BYO
  API-key settings panel (Freesound/Pixabay keys, localStorage only).
  Opened from the hero's "Search samples" button; owns its own scroll
  region inside the locked-viewport shell.
- **Search service** (`src/lib/sampleService.js`): provider-agnostic layer.
  Freesound (APIv2, token auth) and Internet Archive (keyless) are
  implemented and verified against the live APIs; Pixabay is a documented
  stub until its sound-effects endpoint is confirmed.
- **Display helpers** (`src/lib/formatSamples.js`): pure, zero-dependency
  duration/provider/license formatters consumed by the search UI,
  pinned by `test/formatSamples.test.js` (13 tests).
- **Filters** (`src/lib/filterSamples.js` + SearchView filter bar): client-side
  duration range, license-family filter, and sort (relevance / shortest /
  longest / title A–Z / most similar). Filtering runs on fetched results —
  providers are never re-queried. Pinned by `test/filterSamples.test.js`
  (22 tests).
- **Search caching** (`src/lib/searchCache.js` + `SampleSearchService`):
  device-local localStorage cache of recent searches — repeat queries serve
  instantly with a "from cache" badge, max 20 entries, 6h TTL, total outages
  are never pinned. A "Clear search cache" control lives in the settings
  panel (it never touches stored API keys). Pinned by
  `test/searchCache.test.js` (20 tests).
- Search smoke tests: `npm run test:smoke` (126 zero-dependency tests, no
  network).

## Quick start (2 minutes)

```bash
npm install
npm run dev        # or: ./start.sh   (Windows: .\start.ps1, node start.js)
```

1. Open the printed localhost URL — the DOGS Sampler landing page loads.
2. **Keys (optional, unlocks Freesound search):** grab a free key at
   [freesound.org/apiv2/apply](https://freesound.org/apiv2/apply), then either
   paste it into the app's Settings panel (stored only in your browser's
   localStorage) or set it for local dev from `.env.example`:

   ```bash
   cp .env.example .env   # then add VITE_FREESOUND_API_KEY=... — never commit .env
   ```

   Internet Archive search works with no key at all.
3. Sanity-check the service layer: `npm run test:smoke` (88 zero-dependency
   tests, no network).

## Staging / deploy

The production build is GitHub-Pages-ready via the conditional base path in
`vite.config.js`: `npm run dev` serves at root, and building with
`GITHUB_PAGES=1` emits everything under `/sampler/` for
`https://yeahdogs.github.io/sampler/`. Never build with a personal
`VITE_*` API key inlined — staging users enter their own keys in the app's
Settings panel.

```bash
GITHUB_PAGES=1 npm run build   # then push the dist/ output to gh-pages
```

> `.env` is gitignored. Vite inlines `VITE_*` values into the client bundle
> at build time, so `.env` keys are for **local dev only** — never ship a
> public build with a personal key baked in. Long-term, keys move behind a
> DOGS API connection.

## API keys (bring your own)

Search works out of the box for the Internet Archive (no key needed).
Freesound and Pixabay need free keys, entered in the app's Settings panel
and stored **only in your browser's localStorage** — never in the repo.
For local development you can also use a gitignored `.env` file (see
`.env.example`) — `searchAll` resolves keys as
explicit `options.keys` > stored keys > `VITE_*` env.

| Provider | Get a key | Notes |
|---|---|---|
| Freesound | [freesound.org/apiv2/apply](https://freesound.org/apiv2/apply) — see [API docs](https://freesound.org/docs/api/) | Passed as the `token` query param. Previews stream free; downloads need OAuth. |
| Pixabay | [pixabay.com](https://pixabay.com) account → API docs | Provider stub for now — endpoint TBD. |
| Internet Archive | none needed | `advancedsearch.php` + `metadata/` endpoints. |
| Bundled fixtures | none needed | Offline fallback: 8 synthesized drum hits in `public/fixtures/`, served automatically when no keyed provider has a key. |

> **Degraded mode:** with no API keys configured at all, searches still
> return the bundled fixture kit (`local` provider) so the app never sits
> empty or errors — no network, no keys, still playable.

Future: keys may also be served through a DOGS API connection instead of
manual entry.

## Architecture

```
src/
  App.svelte                 Landing shell (hero, i18n, footer)
  lib/
    i18n.js                  svelte-i18n setup (en/es)
    sampleService.js         Provider-agnostic search: Freesound,
                             Internet Archive, Pixabay stub + key storage
  components/
    LanguageSelector.svelte  EN/ES toggle
  messages/{en,es}.json      All UI strings (no hardcoded copy in markup)
  styles/variables.scss      Theme tokens (Batman-Beyond neon-red palette)
```

Rules from `AGENTS.md` (read it before contributing): guard clauses first,
no file over 1000 lines, constants hoisted in SCREAMING_SNAKE_CASE, logic
isolated from markup, Tailwind-first styling with SCSS for custom work,
zero-warning builds, and layouts for all five viewport modes
(mobile portrait/landscape, tablet, desktop, TV/ultrawide).

## Roadmap

1. **Search UI** — ✅ landed (search input, result cards, `<audio>`
   previews, key settings). Next refinements: waveform peek, per-card
   tag chips.
2. **Filters** — ✅ landed (client-side duration range, license-family
   pills, sort — no provider re-queries).
3. **Key settings panel** — paste Freesound/Pixabay keys, stored locally.
4. **Result caching** — ✅ landed (device-local localStorage cache of recent
   searches — repeat queries serve instantly with a "from cache" badge; 20
   entries max, 6h TTL; clearable from the settings panel).
5. **AI processing** — ✅ landed (slices 1–2, 2026-09-09): on-device
   sample analysis, no provider re-queries. `src/lib/audioAnalysis.js`
   (vanilla DSP, zero deps): BPM via onset-envelope autocorrelation
   (5 ms hops, 4x upsample, parabolic peak refinement, fastest-peak
   octave disambiguation — verified 13/14 tempos 60–180 BPM within
   ±2 on synthesized click tracks), musical key via FFT chromagram
   matched against Krumhansl-Schmuckler profiles (verified C major /
   A minor on synthesized triads). Per-card "Analyze" button in the
   search view decodes the preview stream and shows BPM + key chips;
   per-card "Find similar" (slice 2) ranks every result against the
   analyzed track via `analysisSimilarity()` — half/double-time aware
   tempo match plus key relation (same key / relative major-minor /
   fifth) — surfaced as a "Most similar" sort mode with a reference
   chip and one-tap clear. Still open: suggest-next-sample, and
   Freesound `lowlevel.*` descriptor ranking from the README-original
   vision.
6. **Export** — ✅ landed (2026-09-09): JSON sidecar + DAW markers CSV
   download buttons on every analyzed card (en+es), plus a
   `sampler export <track-id> --format json|csv --out FILE` CLI in
   `bin/` (`src/lib/analysisExport.js`, pinned by
   `test/analysisExport.test.js`).

> Note: `src/app.scss` currently sets `overflow-y: hidden` and
> `touch-action: none` on `body` (landing-page lock). The results view will
> need its own scrollable region or a relaxed body policy — tracked as a
> task, not changed yet.

## License & attribution

Sample licenses vary by provider and item (Creative Commons flavors,
public domain, Pixabay terms). The app surfaces each result's license
up front; **always check the license before publishing work that uses a
sample**, and credit creators where required.

## License

MIT — see [LICENSE](LICENSE).

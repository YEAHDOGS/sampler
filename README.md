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
- **Search service** (`src/lib/sampleService.js`): provider-agnostic layer.
  Freesound (APIv2, token auth) and Internet Archive (keyless) are
  implemented and verified against the live APIs; Pixabay is a documented
  stub until its sound-effects endpoint is confirmed.
- **Not yet wired**: the search UI (search box, results list, audio
  preview player, API-key settings panel). The service layer is ready —
  the next milestone is a `SearchView` component that consumes it.

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
3. Sanity-check the service layer: `npm run test:smoke` (24 zero-dependency
   tests, no network).

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

1. **Search UI** — search input + provider result cards + `<audio>` preview
   player with waveform peek. Must handle the locked-viewport body CSS
   (results need a scroll region; see note below).
2. **Filters** — duration range, license filter, sort (relevance/downloads).
3. **Key settings panel** — paste Freesound/Pixabay keys, stored locally.
4. **Result caching** — localStorage/IndexedDB cache of recent searches to
   minimize provider requests (per AGENTS.md cost discipline).
5. **AI processing** — the README-original vision: analyze searched samples
   (BPM/key detection, similarity) to rank and suggest. Freesound's content
   search (`lowlevel.*` descriptors) is a natural first step.
6. **Export** — download pack / copy attribution text per license.

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

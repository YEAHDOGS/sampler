/**
 * DOGS Sampler — provider-agnostic sample search service.
 *
 * Searches royalty-free audio across Freesound, the Internet Archive, and
 * (once wired) Pixabay sound effects, normalizing every hit into a single
 * {@link SampleResult} shape the UI can render without provider-specific code.
 *
 * API keys are never stored in the repo. Callers pass them in via
 * {@link SearchOptions.keys}, or persist them in the browser with
 * {@link saveKeys} / {@link getStoredKeys} (localStorage, user device only).
 *
 * Degraded mode: when no API key is configured for any keyed provider,
 * {@link SampleSearchService} appends a {@link LocalFixtureProvider} serving
 * the bundled offline fixtures, so the app still has playable samples
 * instead of an empty, erroring page.
 */

import { localFixtureResults } from './localFixtures.js';

// ── Hoisted constants ──────────────────────────────────────────────────────

const PROVIDER_FREESOUND = 'freesound';
const PROVIDER_ARCHIVE = 'archive';
const PROVIDER_PIXABAY = 'pixabay';
const PROVIDER_LOCAL = 'local';

const FREESOUND_SEARCH_URL = 'https://freesound.org/apiv2/search/text/';
const FREESOUND_FIELDS = 'id,name,previews,duration,license,url,tags,username';
const FREESOUND_PAGE_SIZE = 24;
/** Freesound APIv2 rejects page_size above 100 — clamp, never error. */
const FREESOUND_MAX_PAGE_SIZE = 100;

const ARCHIVE_SEARCH_URL = 'https://archive.org/advancedsearch.php';
const ARCHIVE_METADATA_URL = 'https://archive.org/metadata/';
const ARCHIVE_DOWNLOAD_URL = 'https://archive.org/download/';
const ARCHIVE_DETAILS_URL = 'https://archive.org/details/';
const ARCHIVE_PAGE_SIZE = 24;
/** Max identifiers to fan out to per-item metadata calls (keeps IA happy). */
const ARCHIVE_METADATA_FANOUT = 8;
/** Lucene syntax chars — backslash-escaped so user input is searched literally. */
const ARCHIVE_QUERY_ESCAPE = /[+\-=&|><!(){}[\]^"~*?:\\/]/g;
const AUDIO_EXTENSIONS = ['.mp3', '.ogg', '.oga', '.wav', '.flac', '.m4a'];

const LOCAL_STORAGE_KEY = 'dogs-sampler:keys';

/**
 * Escape Lucene special characters so a user's raw query is searched
 * literally on archive.org. Without this, producer staples like `hi-hat`,
 * `"deep"`, or `808: sub` either break the query syntax or silently flip
 * word meaning (Lucene `-` means NOT).
 * @param {string} query
 * @returns {string}
 */
function escapeArchiveQuery(query) {
  return query.replace(ARCHIVE_QUERY_ESCAPE, (ch) => `\\${ch}`);
}

/**
 * @typedef {Object} SampleResult
 * @property {string} id Provider-scoped identifier.
 * @property {string} provider One of 'freesound' | 'archive' | 'pixabay' | 'local'.
 * @property {string} title Human-readable title.
 * @property {number|null} duration Seconds, or null when unknown.
 * @property {string|null} previewUrl Direct streamable audio URL (or null).
 * @property {string} pageUrl Canonical page for the sound (attribution link).
 * @property {string|null} license License URL or label, or null when unknown.
 * @property {string[]} tags Provider tags/keywords.
 */

/**
 * @typedef {Object} ProviderResult
 * @property {string} provider Provider id.
 * @property {SampleResult[]} results Normalized hits.
 * @property {number|null} total Total hits reported by the provider.
 * @property {string|null} error Human-readable failure, or null on success.
 */

/**
 * @typedef {Object} SearchOptions
 * @property {number} [limit=24] Max results per provider.
 * @property {number} [page=1] 1-based page.
 * @property {{ freesound?: string, pixabay?: string }} [keys] BYO API keys.
 *   Precedence: explicit `keys` > device-stored keys > dev `.env` (VITE_*).
 */

/**
 * Base class every sample provider implements. Subclasses only need to
 * implement {@link BaseSampleProvider.search}; error normalization and the
 * {@link ProviderResult} envelope live here.
 */
class BaseSampleProvider {
  /** @param {string} name Provider id. @param {boolean} requiresKey Needs a user API key. */
  constructor(name, requiresKey) {
    this.name = name;
    this.requiresKey = requiresKey;
  }

  /**
   * Search the provider. Must never throw — failures come back as
   * `ProviderResult.error` so one dead provider cannot sink the whole search.
   * @param {string} query Free-text query, e.g. "sick snares".
   * @param {SearchOptions} [options]
   * @returns {Promise<ProviderResult>}
   */
  async search(query, options = {}) {
    if (!query || !query.trim()) {
      return { provider: this.name, results: [], total: 0, error: 'Empty query.' };
    }
    try {
      return await this._search(query.trim(), options);
    } catch (err) {
      return {
        provider: this.name,
        results: [],
        total: null,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  /**
   * Provider-specific search implementation.
   * @param {string} query
   * @param {SearchOptions} options
   * @returns {Promise<ProviderResult>}
   */
  // eslint-disable-next-line no-unused-vars
  async _search(query, options) {
    throw new Error(`Provider "${this.name}" does not implement _search().`);
  }
}

/**
 * Freesound APIv2 text search (https://freesound.org/docs/api/).
 * Auth: API key passed as the `token` query parameter.
 */
class FreesoundProvider extends BaseSampleProvider {
  constructor() {
    super(PROVIDER_FREESOUND, true);
  }

  /** @param {string} query @param {SearchOptions} options @returns {Promise<ProviderResult>} */
  async _search(query, options) {
    const token = options.keys?.freesound;
    if (!token) {
      return {
        provider: this.name,
        results: [],
        total: null,
        error: 'Freesound needs an API key — add yours in Settings.',
      };
    }

    const limit = Math.min(
      Math.max(options.limit ?? FREESOUND_PAGE_SIZE, 1),
      FREESOUND_MAX_PAGE_SIZE,
    );
    const page = options.page ?? 1;
    const params = new URLSearchParams({
      query,
      token,
      fields: FREESOUND_FIELDS,
      page_size: String(limit),
      page: String(page),
    });

    const res = await fetch(`${FREESOUND_SEARCH_URL}?${params}`);
    if (!res.ok) throw new Error(`Freesound search failed (HTTP ${res.status}).`);
    const data = await res.json();

    const results = (data.results ?? []).map((sound) => {
      const previews = sound.previews ?? {};
      return {
        id: String(sound.id),
        provider: this.name,
        title: sound.name ?? 'Untitled',
        duration: typeof sound.duration === 'number' ? sound.duration : null,
        previewUrl: previews['preview-hq-mp3'] ?? previews['preview-lq-mp3'] ?? null,
        // https://freesound.org/s/<id>/ 302-redirects to the canonical page,
        // so it is a safe fallback when the API omits both url and username.
        pageUrl:
          sound.url ??
          (sound.username
            ? `https://freesound.org/people/${sound.username}/sounds/${sound.id}/`
            : `https://freesound.org/s/${sound.id}/`),
        license: sound.license ?? null,
        tags: Array.isArray(sound.tags) ? sound.tags : [],
      };
    });

    return { provider: this.name, results, total: data.count ?? null, error: null };
  }
}

/**
 * Internet Archive audio search. No API key required.
 * Step 1: advancedsearch for audio items. Step 2: metadata lookup on the top
 * hits to find a directly playable audio file.
 */
class InternetArchiveProvider extends BaseSampleProvider {
  constructor() {
    super(PROVIDER_ARCHIVE, false);
  }

  /** @param {string} query @param {SearchOptions} options @returns {Promise<ProviderResult>} */
  async _search(query, options) {
    const limit = options.limit ?? ARCHIVE_PAGE_SIZE;
    const page = options.page ?? 1;

    const searchParams = new URLSearchParams({
      q: `mediatype:audio AND (${escapeArchiveQuery(query)})`,
      'fl[]': ['identifier', 'title', 'duration'],
      rows: String(limit),
      page: String(page),
      output: 'json',
    });

    const res = await fetch(`${ARCHIVE_SEARCH_URL}?${searchParams}`);
    if (!res.ok) throw new Error(`Archive.org search failed (HTTP ${res.status}).`);
    const data = await res.json();
    const docs = data?.response?.docs ?? [];

    const enriched = await Promise.all(
      docs.slice(0, ARCHIVE_METADATA_FANOUT).map((doc) => this._enrich(doc)),
    );
    const results = enriched.filter((r) => r !== null);

    return {
      provider: this.name,
      results,
      total: data?.response?.numFound ?? null,
      error: null,
    };
  }

  /**
   * Resolve one advancedsearch doc into a playable {@link SampleResult}.
   * Returns null when no streamable audio file is found (item skipped).
   * @param {{ identifier: string, title?: string, duration?: string }} doc
   * @returns {Promise<SampleResult|null>}
   */
  async _enrich(doc) {
    if (!doc?.identifier) return null;
    try {
      const res = await fetch(`${ARCHIVE_METADATA_URL}${doc.identifier}`);
      if (!res.ok) return null;
      const meta = await res.json();
      const files = meta?.files ?? [];
      const audio = files.find((f) =>
        AUDIO_EXTENSIONS.some((ext) => String(f?.name ?? '').toLowerCase().endsWith(ext)),
      );
      if (!audio?.name) return null;

      const duration = Number.parseFloat(audio.length ?? doc.duration ?? '');
      return {
        id: doc.identifier,
        provider: this.name,
        title: meta?.metadata?.title ?? doc.title ?? doc.identifier,
        duration: Number.isFinite(duration) ? duration : null,
        previewUrl: `${ARCHIVE_DOWNLOAD_URL}${doc.identifier}/${encodeURIComponent(audio.name)}`,
        pageUrl: `${ARCHIVE_DETAILS_URL}${doc.identifier}`,
        license: meta?.metadata?.licenseurl ?? null,
        tags: this._tagsFrom(meta?.metadata),
      };
    } catch {
      return null; // One bad item must not fail the whole page.
    }
  }

  /**
   * @param {Record<string, unknown>|undefined} metadata
   * @returns {string[]}
   */
  _tagsFrom(metadata) {
    if (!metadata) return [];
    const raw = metadata.subject ?? metadata.keywords ?? [];
    const list = Array.isArray(raw) ? raw : [raw];
    return list.map((t) => String(t)).filter(Boolean).slice(0, 12);
  }
}

/**
 * Pixabay sound effects (https://pixabay.com/sound-effects/).
 * Pixabay's public REST API documents image/video search; there is currently
 * no documented public audio-search endpoint, so this provider stays a stub
 * until the endpoint is verified — it fails loudly instead of guessing URLs.
 */
class PixabayProvider extends BaseSampleProvider {
  constructor() {
    super(PROVIDER_PIXABAY, true);
  }

  /** @param {string} query @param {SearchOptions} options @returns {Promise<ProviderResult>} */
  async _search(query, options) {
    if (!options.keys?.pixabay) {
      return {
        provider: this.name,
        results: [],
        total: null,
        error: 'Pixabay needs an API key — add yours in Settings.',
      };
    }
    return {
      provider: this.name,
      results: [],
      total: null,
      error:
        'Pixabay provider not wired yet: verify the sound-effects search endpoint in the Pixabay API docs before implementing.',
    };
  }
}

/**
 * Local fixture provider (degraded / offline mode).
 *
 * Serves the bundled synthesized samples from `public/fixtures/` with no
 * network access and no API key. Never called directly by the UI — the
 * search service appends it when no keyed provider has a usable key.
 */
class LocalFixtureProvider extends BaseSampleProvider {
  constructor() {
    super(PROVIDER_LOCAL, false);
  }

  /** @param {string} query @param {SearchOptions} options @returns {Promise<ProviderResult>} */
  async _search(query, options) {
    const results = localFixtureResults();
    return { provider: this.name, results, total: results.length, error: null };
  }
}

/**
 * Fan-out search across every configured provider. Providers run in parallel
 * and fail independently — a dead provider shows an error card, not a dead page.
 */
class SampleSearchService {
  /** @param {BaseSampleProvider[]} [providers] Defaults to all built-ins. */
  constructor(
    providers = [new FreesoundProvider(), new InternetArchiveProvider(), new PixabayProvider()],
  ) {
    this.providers = providers;
  }

  /**
   * @param {string} query
   * @param {SearchOptions} [options]
   * @returns {Promise<{ query: string, providers: ProviderResult[], results: SampleResult[] }>}
   */
  async searchAll(query, options = {}) {
    if (!query || !query.trim()) {
      return { query: '', providers: [], results: [] };
    }
    // Key precedence: explicit call options > device-stored keys > dev `.env`.
    const mergedOptions = {
      ...options,
      keys: { ...getEnvKeys(), ...getStoredKeys(), ...options.keys },
    };
    // Degraded mode: at least one provider needs a key but none has one —
    // append the bundled offline fixtures so the app still has playable
    // samples. Custom provider lists with no keyed providers are left alone.
    const keyedProviders = this.providers.filter((p) => p.requiresKey);
    const anyKeyUsable = keyedProviders.some(
      (p) => mergedOptions.keys?.[p.name],
    );
    const activeProviders =
      keyedProviders.length > 0 && !anyKeyUsable
        ? [...this.providers, new LocalFixtureProvider()]
        : this.providers;
    const settled = await Promise.all(
      activeProviders.map((p) => p.search(query, mergedOptions)),
    );
    return {
      query: query.trim(),
      providers: settled,
      results: settled.flatMap((r) => r.results),
    };
  }
}

// ── Env key defaults (local dev only — `.env` is gitignored, keys never committed)

/**
 * Read default BYO API keys from Vite env vars (`VITE_FREESOUND_API_KEY`,
 * `VITE_PIXABAY_API_KEY`). Note: Vite inlines `VITE_*` values into the
 * client bundle at build time, so this is for local development only —
 * never ship a public build with a personal key baked in.
 * @param {Record<string, string|undefined>} [source] Defaults to `import.meta.env`; injectable for tests.
 * @returns {{ freesound?: string, pixabay?: string }}
 */
function getEnvKeys(source) {
  const env = source ?? import.meta.env ?? {};
  const pick = (name) => {
    const value = env[name];
    return typeof value === 'string' && value.trim() ? value.trim() : undefined;
  };
  return { freesound: pick('VITE_FREESOUND_API_KEY'), pixabay: pick('VITE_PIXABAY_API_KEY') };
}

// ── Browser key storage (user device only — never committed) ───────────────

/**
 * Read the user's BYO API keys from localStorage.
 * @returns {{ freesound?: string, pixabay?: string }}
 */
function getStoredKeys() {
  try {
    const raw = localStorage.getItem(LOCAL_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return {};
    return { freesound: parsed.freesound ?? undefined, pixabay: parsed.pixabay ?? undefined };
  } catch {
    return {};
  }
}

/**
 * Persist the user's BYO API keys to localStorage (their device only).
 * @param {{ freesound?: string, pixabay?: string }} keys
 */
function saveKeys(keys) {
  try {
    const next = {
      freesound: keys.freesound?.trim() || undefined,
      pixabay: keys.pixabay?.trim() || undefined,
    };
    localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Storage full or unavailable — keys simply won't persist.
  }
}

/** Clear stored API keys from this device. */
function clearKeys() {
  try {
    localStorage.removeItem(LOCAL_STORAGE_KEY);
  } catch {
    // Nothing to clear.
  }
}

export {
  BaseSampleProvider,
  FreesoundProvider,
  InternetArchiveProvider,
  PixabayProvider,
  LocalFixtureProvider,
  SampleSearchService,
  getEnvKeys,
  getStoredKeys,
  saveKeys,
  clearKeys,
  PROVIDER_FREESOUND,
  PROVIDER_ARCHIVE,
  PROVIDER_PIXABAY,
  PROVIDER_LOCAL,
};

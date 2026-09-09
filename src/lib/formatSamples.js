/**
 * DOGS Sampler — display formatting helpers for {@link SampleResult} data.
 *
 * Pure functions, no dependencies: duration formatting, provider badges,
 * and license short-labels. The SearchView component consumes these so
 * markup stays declarative and the formatting stays unit-tested.
 */

// ── Hoisted constants ──────────────────────────────────────────────────────

const SECONDS_PER_MINUTE = 60;
const SECONDS_PER_HOUR = 3600;
const LICENSE_SHORT_LABELS = [
  ['sampling+', 'Sampling+'],
  ['sampling', 'Sampling'],
  ['zero', 'CC0'],
  ['public domain', 'Public domain'],
  ['publicdomain', 'Public domain'],
  ['creativecommons', 'CC'],
  ['creative commons', 'CC'],
  ['pixabay', 'Pixabay'],
];

// ── Duration ───────────────────────────────────────────────────────────────

/**
 * Format a duration in seconds for display, e.g. `4:05` or `1:02:30`.
 * Returns `'--:--'` when the duration is unknown (null/NaN/negative).
 * @param {number|null} seconds
 * @returns {string}
 */
function formatDuration(seconds) {
  if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds < 0) {
    return '--:--';
  }
  const total = Math.floor(seconds);
  const hours = Math.floor(total / SECONDS_PER_HOUR);
  const minutes = Math.floor((total % SECONDS_PER_HOUR) / SECONDS_PER_MINUTE);
  const secs = total % SECONDS_PER_MINUTE;
  const mmss = `${minutes}:${String(secs).padStart(2, '0')}`;
  if (hours === 0) return mmss;
  return `${hours}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

// ── Provider labels ────────────────────────────────────────────────────────

const PROVIDER_LABELS = {
  freesound: 'Freesound',
  archive: 'Internet Archive',
  pixabay: 'Pixabay',
  local: 'Offline kit',
};

/**
 * Human-readable badge label for a provider id.
 * @param {string} provider One of 'freesound' | 'archive' | 'pixabay' | 'local'.
 * @returns {string}
 */
function providerLabel(provider) {
  return PROVIDER_LABELS[provider] ?? provider;
}

/**
 * Short license label for result cards: 'CC0', 'CC', 'Public domain',
 * 'Pixabay', 'Sampling+', or the raw string when it doesn't match a known
 * pattern. Freesound license URLs contain 'creativecommons.org' plus the
 * license slug (e.g. .../licenses/sampling+/1.0/), so pattern matching on
 * the URL fragment covers both URLs and short labels. Check longer patterns
 * first: 'sampling+' must win over 'sampling'.
 * @param {string|null} license License URL or label from the provider.
 * @returns {string}
 */
function licenseShort(license) {
  if (!license) return 'Unknown';
  const lower = String(license).toLowerCase();
  for (const [pattern, label] of LICENSE_SHORT_LABELS) {
    if (lower.includes(pattern)) return label;
  }
  return license;
}

// ── Result grouping ───────────────────────────────────────────────────────

/**
 * Group a flat result list into per-provider buckets for the results UI,
 * preserving provider first-seen order and tagging each bucket with the
 * provider's error (if any) from the search envelope.
 * @param {Array<{ provider: string }>} results Flat {@link SampleResult} list.
 * @param {Array<{ provider: string, error: string|null, total: number|null }>} envelopes
 * @returns {Array<{ provider: string, label: string, error: string|null, total: number|null, results: Array }>}
 */
function groupResultsByProvider(results, envelopes = []) {
  const buckets = [];
  const byProvider = new Map();
  for (const result of results) {
    if (!byProvider.has(result.provider)) {
      const envelope = envelopes.find((e) => e.provider === result.provider);
      const bucket = {
        provider: result.provider,
        label: providerLabel(result.provider),
        error: envelope?.error ?? null,
        total: envelope?.total ?? null,
        results: [],
      };
      byProvider.set(result.provider, bucket);
      buckets.push(bucket);
    }
    byProvider.get(result.provider).results.push(result);
  }
  // Keep provider error cards even when they returned zero hits.
  for (const envelope of envelopes) {
    if (!byProvider.has(envelope.provider) && envelope.error) {
      const bucket = {
        provider: envelope.provider,
        label: providerLabel(envelope.provider),
        error: envelope.error,
        total: envelope.total ?? null,
        results: [],
      };
      byProvider.set(envelope.provider, bucket);
      buckets.push(bucket);
    }
  }
  return buckets;
}

export { formatDuration, providerLabel, licenseShort, groupResultsByProvider };

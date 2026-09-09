/**
 * DOGS Sampler — client-side filtering and sorting for {@link SampleResult}s.
 *
 * Roadmap milestone #2: duration range, license filter, sort. Filtering runs
 * client-side on fetched results so providers are not re-queried (per
 * AGENTS.md cost discipline) and one dead provider's results can still be
 * sliced. All functions are pure and zero-dependency so they stay pin-able
 * with Node's built-in test runner.
 */

// ── Hoisted constants ──────────────────────────────────────────────────────

const LICENSE_CC0 = 'cc0';
const LICENSE_PUBLIC_DOMAIN = 'public-domain';
const LICENSE_CC_BY = 'cc-by';
const LICENSE_CC_BY_SA = 'cc-by-sa';
const LICENSE_CC_BY_NC = 'cc-by-nc';
const LICENSE_CC_BY_ND = 'cc-by-nd';
const LICENSE_SAMPLING = 'sampling+';
const LICENSE_PIXABAY = 'pixabay';
const LICENSE_OTHER = 'other';

/** License families offered as filter options, in display order. */
const LICENSE_FAMILIES = [
  LICENSE_CC0,
  LICENSE_PUBLIC_DOMAIN,
  LICENSE_CC_BY,
  LICENSE_CC_BY_SA,
  LICENSE_CC_BY_NC,
  LICENSE_CC_BY_ND,
  LICENSE_SAMPLING,
  LICENSE_PIXABAY,
  LICENSE_OTHER,
];

/** Short display label per license family (license names are universal — untranslated). */
const LICENSE_FAMILY_LABELS = {
  [LICENSE_CC0]: 'CC0',
  [LICENSE_PUBLIC_DOMAIN]: 'Public domain',
  [LICENSE_CC_BY]: 'CC BY',
  [LICENSE_CC_BY_SA]: 'CC BY-SA',
  [LICENSE_CC_BY_NC]: 'CC BY-NC',
  [LICENSE_CC_BY_ND]: 'CC BY-ND',
  [LICENSE_SAMPLING]: 'Sampling+',
  [LICENSE_PIXABAY]: 'Pixabay',
  [LICENSE_OTHER]: 'Other',
};

/**
 * Slug patterns matched against the lowercased license string, longest and
 * most specific first: 'sampling+' must beat 'sampling', 'by-nc-sa' must
 * beat 'by-nc', and 'by-nc' must beat 'by'.
 */
const LICENSE_CLASSIFIERS = [
  ['sampling+', LICENSE_SAMPLING],
  ['zero', LICENSE_CC0],
  ['publicdomain/zero', LICENSE_CC0],
  ['publicdomain/mark', LICENSE_PUBLIC_DOMAIN],
  ['public domain', LICENSE_PUBLIC_DOMAIN],
  ['publicdomain', LICENSE_PUBLIC_DOMAIN],
  ['by-nc-sa', LICENSE_CC_BY_NC],
  ['by-nc-nd', LICENSE_CC_BY_NC],
  ['by-nc', LICENSE_CC_BY_NC],
  ['by-nd', LICENSE_CC_BY_ND],
  ['by-sa', LICENSE_CC_BY_SA],
  ['noncommercial', LICENSE_CC_BY_NC],
  ['non-commercial', LICENSE_CC_BY_NC],
  ['/by/', LICENSE_CC_BY],
  ['cc-by/', LICENSE_CC_BY],
  ['attribution', LICENSE_CC_BY],
  ['pixabay', LICENSE_PIXABAY],
];

const SORT_RELEVANCE = 'relevance';
const SORT_DURATION_ASC = 'duration-asc';
const SORT_DURATION_DESC = 'duration-desc';
const SORT_TITLE_ASC = 'title-asc';

/** Sort keys accepted by {@link sortSamples}, in UI display order. */
const SORT_KEYS = [SORT_RELEVANCE, SORT_DURATION_ASC, SORT_DURATION_DESC, SORT_TITLE_ASC];

// ── License classification ─────────────────────────────────────────────────

/**
 * Classify a license URL or label into a filter family. Freesound license
 * URLs carry the slug in the path
 * (e.g. `https://creativecommons.org/licenses/by-nc/3.0/`), so one
 * pattern-match pass covers both URLs and short labels.
 * @param {string|null} license License URL or label from the provider.
 * @returns {string} One of the LICENSE_FAMILIES keys.
 */
function classifyLicense(license) {
  if (!license) return LICENSE_OTHER;
  const lower = String(license).toLowerCase();
  for (const [pattern, family] of LICENSE_CLASSIFIERS) {
    if (lower.includes(pattern)) return family;
  }
  return LICENSE_OTHER;
}

/**
 * @param {string} family License family key.
 * @returns {string} Short display label.
 */
function licenseFamilyLabel(family) {
  return LICENSE_FAMILY_LABELS[family] ?? family;
}

// ── Filtering ──────────────────────────────────────────────────────────────

/**
 * A duration bound passes unknown durations only when the bound is unset:
 * when the user sets a min or max, samples with unknown duration are
 * excluded rather than silently slipping through.
 * @param {number|null} duration
 * @param {number|null|undefined} min Minimum seconds, or null/undefined for none.
 * @param {number|null|undefined} max Maximum seconds, or null/undefined for none.
 * @returns {boolean}
 */
function durationInRange(duration, min, max) {
  const valid = typeof duration === 'number' && Number.isFinite(duration) && duration >= 0;
  const hasMin = typeof min === 'number' && Number.isFinite(min);
  const hasMax = typeof max === 'number' && Number.isFinite(max);
  if (!hasMin && !hasMax) return true;
  if (!valid) return false;
  if (hasMin && duration < min) return false;
  if (hasMax && duration > max) return false;
  return true;
}

/**
 * @param {string} license License URL or label.
 * @param {Set<string>|string[]|null|undefined} families Enabled families; null/undefined/empty means all.
 * @returns {boolean}
 */
function licenseAllowed(license, families) {
  if (!families) return true;
  const enabled = families instanceof Set ? families : new Set(families);
  if (enabled.size === 0) return true;
  return enabled.has(classifyLicense(license));
}

/**
 * Filter samples by duration range and license families. Pure: the input
 * array is never mutated.
 * @param {Array<Object>} results {@link SampleResult}s.
 * @param {{ minDuration?: number|null, maxDuration?: number|null, licenses?: Set<string>|string[]|null }} [filters]
 * @returns {Array<Object>} New filtered array.
 */
function filterSamples(results, filters = {}) {
  if (!Array.isArray(results) || results.length === 0) return [];
  return results.filter(
    (r) =>
      durationInRange(r?.duration, filters.minDuration, filters.maxDuration) &&
      licenseAllowed(r?.license, filters.licenses),
  );
}

/**
 * Apply the same filters to each bucket of a grouped result list, keeping
 * bucket metadata (label, error, total) untouched. Buckets left empty by
 * filtering are kept so provider error cards still render.
 * @param {Array<{ provider: string, results: Array<Object>, [k: string]: unknown }>} buckets
 * @param {{ minDuration?: number|null, maxDuration?: number|null, licenses?: Set<string>|string[]|null }} [filters]
 * @returns {Array<{ provider: string, results: Array<Object> }>}
 */
function filterBuckets(buckets, filters = {}) {
  if (!Array.isArray(buckets)) return [];
  return buckets.map((bucket) => ({
    ...bucket,
    results: filterSamples(bucket.results ?? [], filters),
  }));
}

// ── Sorting ────────────────────────────────────────────────────────────────

/**
 * Compare two results by duration, pushing unknown durations to the end.
 * @param {Object} a @param {Object} b @param {boolean} ascending
 * @returns {number}
 */
function compareDuration(a, b, ascending) {
  const da = typeof a?.duration === 'number' && Number.isFinite(a.duration) ? a.duration : null;
  const db = typeof b?.duration === 'number' && Number.isFinite(b.duration) ? b.duration : null;
  if (da === null && db === null) return 0;
  if (da === null) return 1;
  if (db === null) return -1;
  return ascending ? da - db : db - da;
}

/**
 * Sort samples for the results UI. Pure: returns a new array, input
 * untouched. `relevance` is a no-op pass-through preserving provider order;
 * unknown durations always sort to the end.
 * @param {Array<Object>} results {@link SampleResult}s.
 * @param {string} [sortKey] One of SORT_KEYS; unknown keys act as 'relevance'.
 * @returns {Array<Object>} New sorted array.
 */
function sortSamples(results, sortKey = SORT_RELEVANCE) {
  if (!Array.isArray(results) || results.length === 0) return [];
  const copy = [...results];
  if (sortKey === SORT_DURATION_ASC) copy.sort((a, b) => compareDuration(a, b, true));
  else if (sortKey === SORT_DURATION_DESC) copy.sort((a, b) => compareDuration(a, b, false));
  else if (sortKey === SORT_TITLE_ASC)
    copy.sort((a, b) =>
      String(a?.title ?? '').localeCompare(String(b?.title ?? ''), undefined, {
        sensitivity: 'base',
      }),
    );
  return copy;
}

/**
 * Sort every bucket's results by the same key, preserving bucket order and
 * metadata.
 * @param {Array<{ results: Array<Object>, [k: string]: unknown }>} buckets
 * @param {string} [sortKey]
 * @returns {Array<{ results: Array<Object> }>}
 */
function sortBuckets(buckets, sortKey = SORT_RELEVANCE) {
  if (!Array.isArray(buckets)) return [];
  return buckets.map((bucket) => ({
    ...bucket,
    results: sortSamples(bucket.results ?? [], sortKey),
  }));
}

export {
  LICENSE_FAMILIES,
  LICENSE_CC0,
  LICENSE_PUBLIC_DOMAIN,
  LICENSE_CC_BY,
  LICENSE_CC_BY_SA,
  LICENSE_CC_BY_NC,
  LICENSE_CC_BY_ND,
  LICENSE_SAMPLING,
  LICENSE_PIXABAY,
  LICENSE_OTHER,
  SORT_RELEVANCE,
  SORT_DURATION_ASC,
  SORT_DURATION_DESC,
  SORT_TITLE_ASC,
  SORT_KEYS,
  classifyLicense,
  licenseFamilyLabel,
  filterSamples,
  filterBuckets,
  sortSamples,
  sortBuckets,
};

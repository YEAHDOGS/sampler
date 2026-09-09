/**
 * Locale catalog helpers — pure, framework-free utilities for keeping the
 * svelte-i18n message dictionaries (src/messages/*.json) consistent.
 *
 * These exist so the locale catalog can be regression-tested with zero
 * dependencies (node:test + node:assert only), since the i18n runtime itself
 * (svelte-i18n) is a browser-side concern and not importable in a smoke run.
 *
 * AGENTS.md compliance: heavy logic stays out of .svelte presentation files;
 * presentation asks for keys, this module owns the key math.
 */

/** Matches $t("app.title"), t('meta.title') — the key forms used in .svelte and .js sources. */
const MESSAGE_KEY_PATTERN = /(?:\$t|[^a-zA-Z_$]t)\(\s*["']([^"']+)["']\s*\)/g;

/** Matches {name} / {count} interpolation tokens inside message strings. */
const TOKEN_PATTERN = /\{([a-zA-Z_][a-zA-Z0-9_]*)\}/g;

/**
 * Flatten a nested message dictionary to a sorted list of dotted key paths.
 * @param {object} dict - Nested locale dictionary (parsed JSON).
 * @param {string} [prefix] - Internal recursion prefix.
 * @returns {string[]} Sorted dotted keys, e.g. ["app.title", "meta.title"].
 */
export function flattenKeys(dict, prefix = '') {
  if (!dict || typeof dict !== 'object' || Array.isArray(dict)) return [];
  const keys = [];
  for (const key of Object.keys(dict)) {
    const path = prefix ? `${prefix}.${key}` : key;
    const value = dict[key];
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      keys.push(...flattenKeys(value, path));
    } else {
      keys.push(path);
    }
  }
  return keys.sort();
}

/**
 * Compare a target locale's key set against a base locale's.
 * @param {string[]} baseKeys - Dotted keys of the base (reference) locale.
 * @param {string[]} targetKeys - Dotted keys of the locale under test.
 * @returns {{ missing: string[], extra: string[] }} Keys absent from target / unknown to base.
 */
export function diffKeys(baseKeys, targetKeys) {
  const base = new Set(baseKeys);
  const target = new Set(targetKeys);
  const missing = [...base].filter((k) => !target.has(k)).sort();
  const extra = [...target].filter((k) => !base.has(k)).sort();
  return { missing, extra };
}

/**
 * Extract the set of interpolation tokens ({name}) from a message string.
 * @param {string} message - A single locale string.
 * @returns {string[]} Sorted unique token names.
 */
export function interpolationTokens(message) {
  if (typeof message !== 'string') return [];
  const tokens = new Set();
  let match;
  TOKEN_PATTERN.lastIndex = 0;
  while ((match = TOKEN_PATTERN.exec(message)) !== null) {
    tokens.add(match[1]);
  }
  return [...tokens].sort();
}

/**
 * Extract every $t("key") / t('key') message key referenced in a source string.
 * Used to verify the app never asks the runtime for a key no locale defines.
 * @param {string} source - Raw .svelte / .js source text.
 * @returns {string[]} Sorted unique keys.
 */
export function extractMessageKeys(source) {
  if (typeof source !== 'string') return [];
  const keys = new Set();
  let match;
  MESSAGE_KEY_PATTERN.lastIndex = 0;
  while ((match = MESSAGE_KEY_PATTERN.exec(source)) !== null) {
    keys.add(match[1]);
  }
  return [...keys].sort();
}

/**
 * Resolve a dotted key path inside a nested dictionary.
 * @param {object} dict - Parsed locale JSON.
 * @param {string} key - Dotted path, e.g. "app.features.i18n_desc".
 * @returns {unknown} The value at the path, or undefined when absent.
 */
export function lookupKey(dict, key) {
  if (!dict || typeof key !== 'string') return undefined;
  let node = dict;
  for (const part of key.split('.')) {
    if (!node || typeof node !== 'object' || !(part in node)) return undefined;
    node = node[part];
  }
  return node;
}

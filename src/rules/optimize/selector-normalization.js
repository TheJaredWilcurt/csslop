/**
 * @file Normalizes selectors into one comparable spelling, memoized per stylesheet, so rules that select the same elements are recognized as such.
 */

import { unwrapSingleArgumentIsFunctions } from '../selectors.js';

/**
 * Memoizes the normalized form of each selector seen during the current
 * stylesheet.
 *
 * @type {Map<string, string>}
 */
const normalizedSelectorCache = new Map();

/**
 * Discards every memoized normalized selector. The minifier calls this around
 * each stylesheet, so the cache does not outlive the pass that filled it.
 */
function clearNormalizedSelectorCache () {
  normalizedSelectorCache.clear();
}

/**
 * Normalizes a selector string for consistent comparison by trimming
 * and collapsing internal whitespace.
 *
 * @param  {string} selector  The raw selector string.
 * @return {string}           The normalized selector.
 */
function computeNormalizedSelector (selector) {
  // Collapse each whitespace run into a single space
  const collapsed = selector.trim().replace(/\s+/g, ' ');
  // Unwrap single-argument `:is()` so `:is(a)` compares equal to `a`
  const normalized = unwrapSingleArgumentIsFunctions(collapsed, false);
  if (!normalized.includes('::')) {
    return normalized;
  }
  return normalized
    // Convert double-colon ::before/::after to single-colon legacy form
    .replace(/::before\b/g, ':before')
    .replace(/::after\b/g, ':after');
}

/**
 * Normalizes a selector string for consistent comparison, reusing the result
 * when the same selector was already normalized during this stylesheet. Every
 * merge pass compares the same selectors again, so each is only rewritten once.
 *
 * @param  {string} selector  The raw selector string.
 * @return {string}           The normalized selector.
 */
function normalizeSelector (selector) {
  let normalized = normalizedSelectorCache.get(selector);
  if (normalized === undefined) {
    normalized = computeNormalizedSelector(selector);
    normalizedSelectorCache.set(selector, normalized);
  }
  return normalized;
}

export {
  clearNormalizedSelectorCache,
  normalizeSelector
};

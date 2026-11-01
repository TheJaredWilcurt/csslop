/**
 * @file Collapses `hyphenate-limit-chars` values to their shortest equivalent form.
 */

import { hasSubstitutedParts } from './shared.js';

/**
 * Matches a trailing `!important` flag, so the components in front of it can be
 * rewritten without the flag being mistaken for part of the last one.
 *
 * @type {RegExp}
 */
const IMPORTANT_SUFFIX_PATTERN = /!important$/i;

/**
 * Separates a value from the `!important` flag it may end with.
 *
 * @param  {string} value  The declaration value, possibly flagged important.
 * @return {object}        The components in front of the flag, and the flag itself or an empty string.
 */
function splitImportantSuffix (value) {
  const match = value.match(IMPORTANT_SUFFIX_PATTERN);
  if (!match) {
    return { components: value, importantSuffix: '' };
  }
  return {
    components: value.slice(0, match.index).trim(),
    importantSuffix: match[0]
  };
}

/**
 * Collapses a `hyphenate-limit-chars` value to its shortest equivalent form.
 * The property states up to three components: the shortest word that may be
 * hyphenated, then the fewest characters allowed before a hyphen, then the
 * fewest allowed after it. An unstated "before" component is read as `auto`,
 * and an unstated "after" component repeats whatever "before" holds, so a
 * trailing component that only restates the default it stands in for is
 * redundant.
 *
 * @param  {string} value  The `hyphenate-limit-chars` value.
 * @return {string}        The value with its redundant trailing components dropped.
 */
function collapseHyphenateLimitChars (value) {
  const {
    components,
    importantSuffix
  } = splitImportantSuffix(value);
  const parts = components.split(' ').filter(Boolean);
  if (hasSubstitutedParts(parts)) {
    return value;
  }
  const isAfterMatchingBefore = (
    parts.length === 3 &&
    parts[2].toLowerCase() === parts[1].toLowerCase()
  );
  if (isAfterMatchingBefore) {
    parts.pop();
  }
  const isBeforeLeftAtDefault = (
    parts.length === 2 &&
    parts[1].toLowerCase() === 'auto'
  );
  if (isBeforeLeftAtDefault) {
    parts.pop();
  }
  return parts.join(' ') + importantSuffix;
}

export {
  collapseHyphenateLimitChars
};

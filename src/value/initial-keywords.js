/**
 * @file Rewrites a property's `initial` keyword into the shorter value it stands for, and a lengthy initial value into the shorter `initial` keyword.
 */

/**
 * Properties whose `initial` value is a number the browser resolves, so the
 * keyword only ever shortens for the two that have a shorter written form.
 *
 * @type {Set<string>}
 */
const NUMERIC_INITIAL_PROPERTIES = new Set([
  'opacity',
  'z-index',
  'flex-grow',
  'flex-shrink',
  'order',
  'line-height',
  'zoom'
]);

/**
 * Properties whose `initial` value is zero.
 *
 * @type {Set<string>}
 */
const ZERO_INITIAL_PROPERTIES = new Set(['margin', 'padding']);

/**
 * Properties whose `initial` value is `auto`.
 *
 * @type {Set<string>}
 */
const AUTO_INITIAL_PROPERTIES = new Set([
  'min-width',
  'min-height',
  'hyphenate-limit-chars'
]);

/**
 * Properties whose initial value is a single keyword longer than the global
 * `initial` keyword itself. These replacements are applied when serializing
 * declarations, because shorthand builders reconstruct their value from the
 * actual longhand keywords, and a CSS-wide keyword such as `initial` is only
 * valid as a declaration's entire value.
 *
 * @type {Map<string, string>}
 */
const LENGTHY_INITIAL_KEYWORDS = new Map([
  ['background-clip', 'border-box'],
  ['background-origin', 'padding-box'],
  ['border-collapse', 'separate'],
  ['border-color', 'currentcolor'],
  ['border-top-color', 'currentcolor'],
  ['border-right-color', 'currentcolor'],
  ['border-bottom-color', 'currentcolor'],
  ['border-left-color', 'currentcolor'],
  ['box-sizing', 'content-box'],
  ['mask-clip', 'border-box'],
  ['mask-origin', 'border-box'],
  ['vertical-align', 'baseline'],
  ['writing-mode', 'horizontal-tb']
]);

/**
 * Resolves a property's `initial` keyword into the value it stands for, for the
 * properties where that value is shorter to write than the keyword.
 *
 * @param  {string} value     The CSS value string after generic minification.
 * @param  {string} property  The CSS property name.
 * @return {string}           The value with its `initial` keyword resolved where that is shorter.
 */
function resolveInitialKeyword (value, property) {
  if (value !== 'initial') {
    return value;
  }
  if (NUMERIC_INITIAL_PROPERTIES.has(property)) {
    // Just leaving them or mapping some: opacity: initial -> opacity: 1
    if (property === 'opacity') {
      return '1';
    }
    if (property === 'z-index') {
      return 'auto';
    }
  }
  if (ZERO_INITIAL_PROPERTIES.has(property)) {
    return '0';
  }
  if (AUTO_INITIAL_PROPERTIES.has(property)) {
    return 'auto';
  }
  // background-color: initial should become #0000 (transparent)
  if (property === 'background-color') {
    return '#0000';
  }
  return value;
}

/**
 * Rewrites a value that spells its property's initial value with a keyword
 * longer than the global `initial` keyword. Both are equivalent, but `initial`
 * is shorter than these particular keywords and, being repeated across
 * properties, gives gzip more opportunities to deduplicate it.
 *
 * @param  {string} value     The minified declaration value, possibly flagged important.
 * @param  {string} property  The CSS property name.
 * @return {string}           The value with its initial keyword shortened to `initial` when that saves bytes.
 */
function shortenLengthyInitialKeyword (value, property) {
  // A keyword spelling the property's own initial value is shorter as the
  // global keyword (box-sizing: content-box -> box-sizing: initial)
  const initialKeyword = LENGTHY_INITIAL_KEYWORDS.get(property?.toLowerCase());
  if (!initialKeyword || 'initial'.length >= initialKeyword.length) {
    return value;
  }
  // A trailing `!important` rides along inside the value, so the keyword
  // comparison and the rewrite only concern what sits in front of it.
  const isImportant = value.endsWith('!important');
  const keyword = isImportant ? value.slice(0, value.length - '!important'.length) : value;
  if (keyword.toLowerCase() !== initialKeyword) {
    return value;
  }
  return 'initial' + (isImportant ? '!important' : '');
}

export {
  resolveInitialKeyword,
  shortenLengthyInitialKeyword
};

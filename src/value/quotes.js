/**
 * @file Validates and optimizes CSS `quotes` property values by detecting
 * invalid odd-count string tokens and normalizing all-empty-string pairs to `none`.
 */

/**
 * Extracts the inner contents of all quoted string tokens from a raw CSS
 * `quotes` property value. Returns an empty array when the value contains
 * no string tokens (e.g. keyword values like `none` or `auto`).
 *
 * @param  {string} rawValue  The raw CSS value string for a `quotes` declaration.
 * @return {Array}            An array of the inner string contents of each quoted token.
 */
function extractQuotedStringTokens (rawValue) {
  const tokens = [];
  // Match double-quoted or single-quoted strings, handling backslash-escaped characters inside
  const stringTokenPattern = /"([^"\\]*(?:\\.[^"\\]*)*)"|'([^'\\]*(?:\\.[^'\\]*)*)'/g;
  let tokenMatch;
  while ((tokenMatch = stringTokenPattern.exec(rawValue)) !== null) {
    const innerContent = tokenMatch[1] ?? tokenMatch[2];
    tokens.push(innerContent);
  }
  return tokens;
}

/**
 * Determines whether a `quotes` declaration has an odd number of string
 * values, which is invalid per the CSS specification and silently ignored
 * by browsers.
 *
 * @param  {string}  rawValue  The raw CSS value string for a `quotes` declaration.
 * @return {boolean}           True if the value contains an odd number of quoted string tokens.
 */
function hasInvalidQuotesCount (rawValue) {
  const tokens = extractQuotedStringTokens(rawValue);
  if (tokens.length === 0) {
    return false;
  }
  return tokens.length % 2 !== 0;
}

/**
 * Determines whether a `quotes` declaration consists entirely of pairs
 * of empty strings, making it functionally equivalent to `quotes: none`.
 *
 * @param  {string}  rawValue  The raw CSS value string for a `quotes` declaration.
 * @return {boolean}           True if the value is an even number of empty quoted strings.
 */
function isQuotesNoneEquivalent (rawValue) {
  const tokens = extractQuotedStringTokens(rawValue);
  if (tokens.length === 0 || tokens.length % 2 !== 0) {
    return false;
  }
  return tokens.every((token) => {
    return token === '';
  });
}

export {
  hasInvalidQuotesCount,
  isQuotesNoneEquivalent
};

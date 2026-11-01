/**
 * @file Minifies `url()` tokens, and temporarily replaces them with markers so generic value rewrites cannot alter the data a URL carries.
 */

import {
  findMatchingParenthesis,
  startsUrlToken
} from '../parser/source-search.js';

import { splitValueSegments } from './segments.js';
import { minifySvgDataUri } from './svg/data-uri.js';

/**
 * Escapes the characters an unquoted url() token cannot hold, so the path can
 * drop its quotes. A backslash already escaping a character is left alone, so
 * a path that arrived escaped is never escaped a second time.
 *
 * @param  {string} path  The url path, without surrounding quotes.
 * @return {string}       The path with every bare space and parenthesis escaped.
 */
function escapeUrlPathCharacters (path) {
  // Match each space and parenthesis that no escaping backslash precedes
  return path.replace(/(?<!\\)([ ()])/g, '\\$1');
}

/**
 * Chooses the shortest valid representation for the path inside a `url(...)`
 * token, weighing an unquoted form — its spaces and parentheses escaped —
 * against a quoted form. Quotation marks can only ever appear in the quoted
 * form, so a path holding one always keeps its wrapper.
 *
 * @param  {string} path  The resolved url path, without surrounding quotes.
 * @return {string}       The shortest valid url() content string.
 */
function formatUrlPath (path) {
  // Escape any embedded double quotes so the double-quoted wrapper stays valid
  const quotedForm = '"' + path.replace(/"/g, '\\"') + '"';
  // Match a quotation mark, which an unquoted url() token cannot hold
  if (/["']/.test(path)) {
    return quotedForm;
  }
  const unquotedForm = escapeUrlPathCharacters(path);
  // Each escaped character costs one backslash, so dropping the two quotation
  // marks pays off whenever at most one character needs escaping
  if (unquotedForm.length < quotedForm.length) {
    return unquotedForm;
  }
  return quotedForm;
}

/**
 * Produces the shortest valid contents for a single `url(...)` token from the
 * raw text between its parentheses, stripping a leading current-directory
 * indicator and normalizing quoting.
 *
 * @param  {string} rawContent  The trimmed text found between the url parentheses.
 * @return {string}             The minified url() content.
 */
function minifyUrlContent (rawContent) {
  const wasQuoted = rawContent.startsWith('"') || rawContent.startsWith('\'');
  let path = rawContent;
  if (wasQuoted) {
    const quote = rawContent[0];
    if (rawContent.length >= 2 && rawContent.endsWith(quote)) {
      path = rawContent.slice(1, -1);
    }
  }

  const minifiedSvgDataUri = minifySvgDataUri(path);
  if (minifiedSvgDataUri) {
    return minifiedSvgDataUri;
  }

  // Remove a leading current-directory indicator (`./`); browsers resolve it implicitly
  path = path.replace(/^\.\//, '');

  return formatUrlPath(path);
}

/**
 * Builds a marker that cannot appear in a parsed CSS value. URL functions are
 * temporarily replaced with these markers while generic string operations run.
 *
 * @param  {number} index  The URL token index.
 * @return {string}        The marker representing that URL token.
 */
function createUrlTokenMarker (index) {
  return '\u0000csslop-url-' + index + '\u0000';
}

/**
 * Replaces URL tokens with stable markers so generic value normalization does
 * not alter data carried inside a URL.
 *
 * @param  {string} value  The CSS value to protect.
 * @return {object}        The protected value and the original URL tokens.
 */
function protectUrlTokens (value) {
  const urlTokens = [];
  let protectedValue = '';
  for (const segment of splitValueSegments(value)) {
    const isUrlToken = segment.isLiteral && startsUrlToken(segment.text, 0);
    if (isUrlToken) {
      protectedValue += createUrlTokenMarker(urlTokens.length);
      urlTokens.push(segment.text);
    } else {
      protectedValue += segment.text;
    }
  }
  return { value: protectedValue, urlTokens };
}

/**
 * Restores the URL tokens removed by `protectUrlTokens`.
 *
 * @param  {string} value      The value containing URL markers.
 * @param  {Array}  urlTokens  The original URL token text.
 * @return {string}            The value with URL tokens restored.
 */
function restoreUrlTokens (value, urlTokens) {
  let restoredValue = value;
  for (let index = 0; index < urlTokens.length; index++) {
    const marker = createUrlTokenMarker(index);
    restoredValue = restoredValue.split(marker).join(urlTokens[index]);
  }
  return restoredValue;
}

/**
 * Removes whitespace after protected URL tokens. A CSS URL token closes itself
 * at `)`, so the following component remains distinguishable without a space.
 *
 * @param  {string} value      The protected CSS value.
 * @param  {Array}  urlTokens  The original URL token text.
 * @return {string}            The protected value without trailing URL spacing.
 */
function removeWhitespaceAfterUrlTokens (value, urlTokens) {
  let compactValue = value;
  for (let index = 0; index < urlTokens.length; index++) {
    const marker = createUrlTokenMarker(index);
    const markerIndex = compactValue.indexOf(marker);
    if (markerIndex === -1) {
      continue;
    }
    const contentStart = markerIndex + marker.length;
    let nextContentIndex = contentStart;
    while (' \t\n\r\f'.includes(compactValue[nextContentIndex])) {
      nextContentIndex++;
    }
    compactValue = compactValue.slice(0, contentStart) + compactValue.slice(nextContentIndex);
  }
  return compactValue;
}

/**
 * Removes an explicit default background position directly after a protected
 * URL marker, where the ordinary close-parenthesis optimization cannot see it.
 *
 * @param  {string} value      The protected background value.
 * @param  {Array}  urlTokens  The original URL token text.
 * @return {string}            The value with redundant URL positions removed.
 */
function removeDefaultBackgroundPositionsAfterUrlTokens (value, urlTokens) {
  let normalizedValue = value;
  for (let index = 0; index < urlTokens.length; index++) {
    const marker = createUrlTokenMarker(index);
    // Match a URL marker followed by the default 0 0 background-position pair.
    const defaultPositionPattern = new RegExp(
      marker + '\\s*0(?:%|px)?\\s+0(?:%|px)?(?=\\s|$)',
      'g'
    );
    normalizedValue = normalizedValue.replace(defaultPositionPattern, marker);
  }
  return normalizedValue;
}

/**
 * Rewrites every `url(...)` token in a CSS value to its shortest valid form,
 * skipping any quoted strings so an embedded `url(` inside a string is ignored.
 *
 * @param  {string} value  The CSS value string potentially containing url() tokens.
 * @return {string}        The value with all url() tokens minified.
 */
function minifyUrls (value) {
  let result = '';
  let index = 0;

  const consumeQuoted = (start) => {
    const quote = value[start];
    let end = start + 1;
    while (end < value.length) {
      if (value[end] === '\\') {
        end += 2;
        continue;
      }
      if (value[end] === quote) {
        end++;
        break;
      }
      end++;
    }
    return end;
  };

  const startsUrl = (start) => {
    return value.slice(start, start + 4).toLowerCase() === 'url(';
  };

  while (index < value.length) {
    if (value[index] === '"' || value[index] === '\'') {
      const end = consumeQuoted(index);
      result += value.slice(index, end);
      index = end;
      continue;
    }

    if (startsUrl(index)) {
      const closingParenIndex = findMatchingParenthesis(value, index + 3);
      if (closingParenIndex === -1) {
        result += value.slice(index);
        break;
      }
      const inner = value.slice(index + 4, closingParenIndex).trim();
      result += 'url(' + minifyUrlContent(inner) + ')';
      index = closingParenIndex + 1;
      continue;
    }

    result += value[index];
    index++;
  }

  return result;
}

export {
  minifyUrls,
  protectUrlTokens,
  removeDefaultBackgroundPositionsAfterUrlTokens,
  removeWhitespaceAfterUrlTokens,
  restoreUrlTokens
};

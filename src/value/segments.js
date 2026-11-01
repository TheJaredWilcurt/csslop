/**
 * @file Splits a CSS value into the literal segments that hold data, quoted strings and `url()` tokens, and the syntax between them, so rewrites only ever reach the syntax.
 */

import {
  skipParenthesizedGroup,
  skipQuotedString,
  startsUrlToken
} from '../parser/source-search.js';

/**
 * @typedef  {object}  ValueSegment
 * @property {string}  text          The segment's slice of the value.
 * @property {boolean} isLiteral     Whether the segment is a quoted string or a url() token.
 */

/**
 * Splits a CSS value into literal and syntax segments. A quoted string and a
 * `url()` token are literals: they hold data rather than CSS syntax, so no pass
 * may rewrite what is inside them. Everything between the literals is syntax.
 *
 * @param  {string} value  The full CSS value string.
 * @return {Array}         The value's segments, in order.
 */
function splitValueSegments (value) {
  const segments = [];
  let index = 0;

  while (index < value.length) {
    if (value[index] === '"' || value[index] === '\'') {
      const end = skipQuotedString(value, index);
      segments.push({ text: value.slice(index, end), isLiteral: true });
      index = end;
      continue;
    }

    if (startsUrlToken(value, index)) {
      // The `url(` token opens its parenthesized group at its fourth character
      const end = skipParenthesizedGroup(value, index + 3);
      segments.push({ text: value.slice(index, end), isLiteral: true });
      index = end;
      continue;
    }

    const start = index;
    while (index < value.length && value[index] !== '"' && value[index] !== '\'' && !startsUrlToken(value, index)) {
      index++;
    }
    segments.push({ text: value.slice(start, index), isLiteral: false });
  }

  return segments;
}

/**
 * Applies a replacer function only to segments of a CSS value that are outside quoted strings and url() functions, preserving those literal segments unchanged.
 *
 * @param  {string}                   value     The full CSS value string.
 * @param  {function(string): string} replacer  A function called with each non-string, non-url segment, returning the replacement string.
 * @return {string}                             The value with the replacer applied to all eligible segments.
 */
function replaceOutsideStringsAndUrls (value, replacer) {
  return splitValueSegments(value).map((segment) => {
    if (segment.isLiteral) {
      return segment.text;
    }
    return replacer(segment.text);
  }).join('');
}

export {
  replaceOutsideStringsAndUrls,
  splitValueSegments
};

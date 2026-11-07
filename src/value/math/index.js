/**
 * @file Simplifies CSS math functions (calc, min, max) by folding constant expressions, flattening nested calcs, and converting absolute lengths to pixels.
 */

import {
  convertAbsoluteLengthToPx,
  formatResolvedNumber,
  roundCompactNumber
} from '../shared.js';

import { simplifyCalc } from './evaluate.js';
import {
  foldStandaloneCalc,
  resolveCalcExpression
} from './fold.js';
import { MATH_FUNCTION_NAMES } from './functions.js';
import { clampResolvedValueToPropertyRange } from './property-ranges.js';
import {
  convertReciprocalMultiplicationToDivision,
  rewriteMathFunctionContents,
  shortenDecimalNumbers
} from './rewrite.js';

/**
 * Characters that start a token able to sit directly against a value that
 * precedes them, so no whitespace is needed to keep the two tokens apart:
 * whitespace already separates, and openers like `#`, `!`, or any bracket or
 * punctuation mark their own token's start. Mirrors the tokenizer's notion of
 * tokens marking their own start, with `/` on top since it delimits a size
 * from a position in layered shorthands.
 *
 * @type {Set<string>}
 */
const SELF_DELIMITING_FOLLOWERS = new Set([
  ' ',
  '\t',
  '\n',
  '\r',
  '\f',
  '#',
  '!',
  '"',
  '\'',
  '(',
  ')',
  '[',
  ']',
  '{',
  '}',
  ',',
  ':',
  ';',
  '/'
]);

/**
 * Reports whether a math function's replacement glues itself to the character
 * following the matched function, merging two values into one token. A
 * replacement that keeps its function form ends with a parenthesis, which
 * closes itself; only a bare resolved value needs the whitespace that the
 * parenthesis padding removal took away.
 *
 * @param  {string}  replacement         The string the math function resolved to.
 * @param  {string}  followingCharacter  The character directly after the matched function.
 * @return {boolean}                     Whether a separating space must be restored.
 */
function mergesWithFollowingCharacter (replacement, followingCharacter) {
  if (replacement.endsWith(')') || !followingCharacter) {
    return false;
  }
  return !SELF_DELIMITING_FOLLOWERS.has(followingCharacter);
}

/**
 * Wraps a math-function replacer so a function that dissolves into a bare
 * value does not lose the whitespace separating it from the value behind it.
 * The values were once told apart by where the function's parentheses sat, so
 * when the parentheses go, the separator has to stay.
 *
 * @param  {function(string, ...(string|number|undefined)): string} replacer  The replacement callback for `String.prototype.replace`.
 * @return {function(string, ...(string|number|undefined)): string}           A replacer that keeps the trailing separator intact.
 */
function keepSeparatorAfterDissolvedFunction (replacer) {
  return (match, ...rest) => {
    const replacement = replacer(match, ...rest);
    // A replace callback's trailing arguments are the match offset and the full string
    const fullText = rest[rest.length - 1];
    const matchOffset = rest[rest.length - 2];
    const followingCharacter = fullText[matchOffset + match.length];
    if (mergesWithFollowingCharacter(replacement, followingCharacter)) {
      return replacement + ' ';
    }
    return replacement;
  };
}

/**
 * Matches a math function other than `calc()` whose arguments hold no further
 * parentheses, so that the whole of the function is matched. A `calc()` is
 * left to its own pass, which weighs what the calculation resolves to against
 * the calculation itself.
 *
 * @type {RegExp}
 */
const RESOLVABLE_MATH_FUNCTION = new RegExp(
  '\\b(?:' +
  [...MATH_FUNCTION_NAMES].filter((name) => {
    return name !== 'calc';
  }).join('|') +
  ')\\([^()]+\\)',
  'gi'
);

/**
 * Runs one pass of the math simplifications over a value: the rewrites that
 * state a calculation more compactly, and the resolutions that replace a math
 * function with the value it works out to.
 *
 * @param  {string} value     The CSS value string containing math functions to simplify.
 * @param  {string} property  The CSS property name, whose range every resolved result is clamped into.
 * @return {string}           The value with its math functions simplified where possible.
 */
function simplifyMathFunctionsOnce (value, property) {
  let result = rewriteMathFunctionContents(shortenDecimalNumbers, value);
  result = rewriteMathFunctionContents(convertReciprocalMultiplicationToDivision, result);

  // Unwrap calc(1 / (1 / x)) → x (double-reciprocal identity)
  result = result.replace(/calc\(\s*1\s*\/\s*\(\s*1\s*\/\s*([^()]+)\s*\)\s*\)/gi, keepSeparatorAfterDissolvedFunction((match, inner) => {
    return inner.trim();
  }));
  // Flatten calc(calc(a) ± b) → calc(a ± b)
  result = result.replace(/calc\(\s*calc\(([^()]+)\)\s*([+-])\s*([^()]+)\s*\)/gi, keepSeparatorAfterDissolvedFunction((match, inner, operator, tail) => {
    return 'calc(' + inner + ' ' + operator + ' ' + tail + ')';
  }));
  // Unwrap calc(calc(x)) → calc(x)
  result = result.replace(/calc\(\s*calc\(([^()]+)\)\s*\)/gi, keepSeparatorAfterDissolvedFunction((match, inner) => {
    return 'calc(' + inner + ')';
  }));

  // Resolve every math function that compares or rounds its arguments
  result = result.replace(RESOLVABLE_MATH_FUNCTION, keepSeparatorAfterDissolvedFunction((match) => {
    const simplified = simplifyCalc(match);
    if (simplified === null) {
      return match;
    }
    return clampResolvedValueToPropertyRange(simplified, property);
  }));

  // Simplify calc() expressions using constant folding and expression resolution
  result = result.replace(/calc\(([^()]+)\)/gi, keepSeparatorAfterDissolvedFunction((match, inner) => {
    // Collapse whitespace inside calc expression
    const compactInner = inner.replace(/\s+/g, ' ').trim();
    const resolved = resolveCalcExpression(match, compactInner);
    return clampResolvedValueToPropertyRange(resolved, property);
  }));

  return result;
}

/**
 * Simplifies every math function within a CSS value string, resolving the ones
 * whose operands are all known and stating the rest as compactly as they can
 * be written.
 *
 * @param  {string} value          The CSS value string containing math functions to simplify.
 * @param  {string} property       The CSS property name, whose range every resolved result is clamped into.
 * @param  {string} originalValue  The value as it was authored, which tells whether a result was ever part of a calculation.
 * @return {string}                The value with math functions simplified where possible.
 */
function normalizeMathFunctions (value, property, originalValue = '') {
  let result = value;
  if (value.includes('(')) {
    let previous;

    do {
      previous = result;
      // Resolving a math function leaves a plain value where it stood, which can
      // bring the function it was nested in within reach of the next pass, so
      // the value is simplified until it settles
      result = simplifyMathFunctionsOnce(result, property);
    } while (result !== previous);
  }

  // When calc() folded to an absolute-length unit (pt, pc, in, cm, mm, q), convert to pixels
  if (originalValue.includes('calc(') && /^-?(?:\d+|\d*\.\d+)(pt|pc|in|cm|mm|q)$/i.test(result)) {
    // Extract the absolute-length unit from the folded result
    const [, unit] = result.match(/^-?(?:\d+|\d*\.\d+)(pt|pc|in|cm|mm|q)$/i);
    const numeric = parseFloat(result);
    const pxValue = convertAbsoluteLengthToPx(numeric, unit);
    if (pxValue !== null) {
      result = roundCompactNumber(pxValue) + 'px';
    }
  }

  // Round a result whose decimal places run past the budget a resolved number is written within
  result = result.replace(/(-?(?:\d+|\d*\.\d+)\.\d{4,})([a-z%]+)/gi, (match, number, unit) => {
    return formatResolvedNumber(number) + unit;
  });
  return result;
}

/**
 * Simplifies a value that is a single `calc()`, holding whatever it resolves
 * to inside the range the property it is declared on accepts.
 *
 * @param  {string} value     The CSS value string that may be a standalone calc() expression.
 * @param  {string} property  The CSS property the value is declared on.
 * @return {string}           The simplified value, or the original value if simplification is not applicable.
 */
function simplifyStandaloneCalc (value, property = '') {
  // Check if value starts with calc( and ends with )
  if (!/^calc\(/i.test(value) || !value.endsWith(')')) {
    return value;
  }
  return clampResolvedValueToPropertyRange(foldStandaloneCalc(value), property);
}

export {
  normalizeMathFunctions,
  simplifyStandaloneCalc
};

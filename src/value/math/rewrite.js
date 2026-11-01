/**
 * @file Rewrites the contents of CSS math functions into shorter equivalents, such as dropping redundant zeros from decimals and turning reciprocal multiplications into divisions.
 */

import { findMatchingParenthesis } from '../../parser/source-search.js';

import { MATH_FUNCTION_NAMES } from './functions.js';

/**
 * Matches a single character that may appear in a CSS function name.
 *
 * @type {RegExp}
 */
const FUNCTION_NAME_CHARACTER = /[a-zA-Z-]/;

/**
 * Finds where the function name that ends at an opening parenthesis begins.
 *
 * @param  {string} value      The CSS value string being scanned.
 * @param  {number} openIndex  The index of the opening parenthesis.
 * @return {number}            The index of the function name's first character.
 */
function findFunctionNameStart (value, openIndex) {
  let index = openIndex;
  while (index > 0 && FUNCTION_NAME_CHARACTER.test(value[index - 1])) {
    index--;
  }
  return index;
}

/**
 * Rewrites the contents of every math function in a value, leaving the rest of
 * the value untouched. A `*` only means multiplication inside these functions,
 * so an arithmetic rewrite may only reach the text between their parentheses.
 * The whole of a math function is handed over at once, so a math function
 * nested in another is rewritten as part of its parent.
 *
 * @param  {function(string): string} rewriteExpression  Receives a math function's contents and returns its replacement.
 * @param  {string}                   value              The CSS value string to rewrite.
 * @return {string}                                      The value with every math function's contents rewritten.
 */
function rewriteMathFunctionContents (rewriteExpression, value) {
  let result = '';
  let index = 0;
  while (index < value.length) {
    const openIndex = value.indexOf('(', index);
    if (openIndex === -1) {
      break;
    }
    const functionName = value.slice(findFunctionNameStart(value, openIndex), openIndex).toLowerCase();
    const closeIndex = findMatchingParenthesis(value, openIndex);
    if (!MATH_FUNCTION_NAMES.has(functionName) || closeIndex === -1) {
      result += value.slice(index, openIndex + 1);
      index = openIndex + 1;
      continue;
    }
    result += value.slice(index, openIndex + 1);
    result += rewriteExpression(value.slice(openIndex + 1, closeIndex));
    index = closeIndex;
  }
  return result + value.slice(index);
}

/**
 * Matches a number written with a decimal point that begins a token of its
 * own, capturing its sign, the digits before its decimal point, and the digits
 * after it. The lookbehind keeps the match from starting partway through an
 * identifier (`--x0.5`) or another number, and the lookahead keeps it from
 * matching a fragment of a dotted name such as `0.5.png`.
 *
 * @type {RegExp}
 */
const DECIMAL_NUMBER = /(?<![\w.-])([+-]?)(\d*)\.(\d+)(?![\d.])/g;

/**
 * Writes a decimal number in the fewest characters that state the same value,
 * dropping the zeros before its whole part (`0.25` → `.25`) and after its
 * fraction (`1.50` → `1.5`), along with a decimal point left with no fraction
 * behind it (`2.0` → `2`). The digits that remain are kept as written, so no
 * precision is lost.
 *
 * @param  {string} sign            The sign written before the number, empty when there is none.
 * @param  {string} wholeDigits     The digits written before the decimal point.
 * @param  {string} fractionDigits  The digits written after the decimal point.
 * @return {string}                 The number written as compactly as it can be.
 */
function shortenDecimalNumber (sign, wholeDigits, fractionDigits) {
  // Leading zeros of the whole part
  const wholePart = wholeDigits.replace(/^0+/, '');
  // Trailing zeros of the fraction
  const fractionPart = fractionDigits.replace(/0+$/, '');
  if (!fractionPart) {
    return sign + (wholePart || '0');
  }
  return sign + wholePart + '.' + fractionPart;
}

/**
 * Shortens every decimal number in the contents of a math function. Numbers
 * that follow an operator written without whitespace (`x*0.25s`) are out of
 * reach of the general number shortening, which only looks past a separator.
 *
 * @param  {string} expression  The contents of a math function.
 * @return {string}             The expression with every decimal number written as compactly as it can be.
 */
function shortenDecimalNumbers (expression) {
  return expression.replace(DECIMAL_NUMBER, (match, sign, wholeDigits, fractionDigits) => {
    return shortenDecimalNumber(sign, wholeDigits, fractionDigits);
  });
}

/**
 * Matches a multiplication by a decimal below one, capturing the digits after
 * its decimal point and the unit written on it (so a multiplier with a unit
 * can be recognized and left alone). The trailing lookahead keeps
 * the match away from numbers that only begin this way, such as the exponent
 * of `.5e3` or a unit name that is still being read.
 *
 * @type {RegExp}
 */
const FRACTIONAL_MULTIPLIER = /\s*\*\s*0*\.(\d+)([a-z%]*)(?![\w.%(])/gi;

/**
 * The most decimal places a fraction may be built from while the power of ten
 * it needs is still exactly representable as an integer.
 *
 * @type {number}
 */
const MAXIMUM_FRACTION_DIGITS = 15;

/**
 * Computes the greatest common divisor of two non-negative integers, which is
 * what a fraction has to be divided by to be stated in lowest terms.
 *
 * @param  {number} first   The first integer.
 * @param  {number} second  The second integer.
 * @return {number}         The greatest common divisor of both integers.
 */
function greatestCommonDivisor (first, second) {
  let dividend = first;
  let divisor = second;
  while (divisor) {
    const remainder = dividend % divisor;
    dividend = divisor;
    divisor = remainder;
  }
  return dividend;
}

/**
 * Converts the digits behind a decimal point into the whole number that
 * dividing by scales a value exactly as multiplying by that decimal does.
 * The digits `25` (of `.25`) state the fraction 25/100, which reduces to 1/4,
 * so the divisor is `4`. A fraction that does not reduce to a numerator of one
 * cannot be stated as a single division, and so has no divisor to give.
 *
 * @param  {string}      fractionDigits  The digits written after the decimal point.
 * @return {number|null}                 The equivalent whole number divisor, or null when there is none.
 */
function reciprocalOfDecimalFraction (fractionDigits) {
  if (fractionDigits.length > MAXIMUM_FRACTION_DIGITS) {
    return null;
  }
  const numerator = Number(fractionDigits);
  const denominator = 10 ** fractionDigits.length;
  const commonFactor = greatestCommonDivisor(numerator, denominator);
  if (numerator / commonFactor !== 1) {
    return null;
  }
  return denominator / commonFactor;
}

/**
 * Builds the division that scales a value exactly as multiplying it by a
 * unitless decimal below one does, when that division is no longer to write
 * than the multiplication. A multiplier carrying a unit is never rewritten:
 * dividing by a dimension inverts its unit in the type of the result
 * (`x*.25s` is a time, while `x/4s` is per unit of time), so the two would not
 * be equivalent.
 *
 * @param  {string}      fractionDigits  The digits written after the decimal point of the multiplier.
 * @param  {string}      unit            The unit written on the multiplier, empty when it is unitless.
 * @return {string|null}                 The equivalent division, or null when there is none worth using.
 */
function divisionEquivalentToFractionalMultiplier (fractionDigits, unit) {
  if (unit) {
    return null;
  }
  const divisor = reciprocalOfDecimalFraction(fractionDigits);
  if (divisor === null) {
    return null;
  }
  const division = '/' + divisor;
  // Compared against the shortest the multiplication could have been written
  const multiplication = '*.' + fractionDigits;
  if (division.length > multiplication.length) {
    return null;
  }
  return division;
}

/**
 * Rewrites a multiplication by a unitless decimal below one as a division by
 * the whole number that decimal is the reciprocal of, which is never longer to
 * write and usually shorter (`calc(var(--x)*.25)` → `calc(var(--x)/4)`).
 * Multipliers with a unit are left as written, since dividing by a dimension
 * would invert its unit.
 *
 * @param  {string} expression  The contents of a math function.
 * @return {string}             The expression with reciprocal multipliers stated as divisions.
 */
function convertReciprocalMultiplicationToDivision (expression) {
  return expression.replace(FRACTIONAL_MULTIPLIER, (match, fractionDigits, unit) => {
    return divisionEquivalentToFractionalMultiplier(fractionDigits, unit) ?? match;
  });
}

export {
  convertReciprocalMultiplicationToDivision,
  rewriteMathFunctionContents,
  shortenDecimalNumbers
};

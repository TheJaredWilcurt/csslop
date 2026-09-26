/**
 * @file Simplifies CSS math functions (calc, min, max) by folding constant expressions, flattening nested calcs, and converting absolute lengths to pixels.
 */

import { findMatchingParenthesis } from '../parser/source-search.js';

import {
  formatUnitTotals,
  MATH_FUNCTION_NAMES,
  simplifyCalc
} from './math-expression.js';
import {
  convertAbsoluteLengthToPx,
  formatResolvedDimension,
  formatResolvedNumber,
  roundCompactNumber
} from './shared.js';

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
 * Matches a multiplication by a decimal below one, capturing the digits after
 * its decimal point and the unit written on it. The trailing lookahead keeps
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
 * Rewrites a multiplication by a decimal below one as a division by the whole
 * number that decimal is the reciprocal of, which is never longer to write and
 * usually shorter (`calc(var(--x)*.25)` → `calc(var(--x)/4)`). A unit written
 * on the multiplier moves onto the divisor, since only how the operand is
 * stated changes.
 *
 * @param  {string} expression  The contents of a math function.
 * @return {string}             The expression with reciprocal multipliers stated as divisions.
 */
function convertReciprocalMultiplicationToDivision (expression) {
  return expression.replace(FRACTIONAL_MULTIPLIER, (match, fractionDigits, unit) => {
    const divisor = reciprocalOfDecimalFraction(fractionDigits);
    if (divisor === null) {
      return match;
    }
    const division = '/' + divisor + unit;
    // Compared against the shortest the multiplication could have been written
    const multiplication = '*.' + fractionDigits + unit;
    if (division.length > multiplication.length) {
      return match;
    }
    return division;
  });
}

/**
 * Matches a whole expression that divides a percentage by a plain number,
 * capturing the percentage and the divisor it is shared out between.
 *
 * @type {RegExp}
 */
const PERCENTAGE_DIVISION = /^([+-]?(?:\d+|\d*\.\d+))%\s*\/\s*([+-]?(?:\d+|\d*\.\d+))$/;

/**
 * Picks between what a calculation resolved to and the calculation itself,
 * keeping whichever takes fewer characters to write. A tie goes to the
 * resolved value, which states the same thing without the arithmetic.
 *
 * @param  {string} resolved     The value the calculation resolves to.
 * @param  {string} calculation  The calculation, written as compactly as it can be.
 * @return {string}              The shorter of the two.
 */
function shorterOfResolutionAndCalculation (resolved, calculation) {
  if (resolved.length <= calculation.length) {
    return resolved;
  }
  return calculation;
}

/**
 * Writes a calculation as compactly as its syntax allows, squeezing out every
 * space but the ones a `+` or a `-` needs to be read as an operator.
 *
 * @param  {string} inner  The contents of the `calc()`.
 * @return {string}        The whole `calc()`, written as compactly as it can be.
 */
function compactCalculation (inner) {
  // Remove whitespace around multiplication and division operators
  const compactInner = inner.replace(/\s+/g, ' ').trim().replace(/\s*([*/])\s*/g, '$1');
  return 'calc(' + compactInner + ')';
}

/**
 * Picks between a calculation and what resolving its arithmetic came to. A
 * resolved value states the same thing without any arithmetic, so it wins a
 * tie, but a result that is itself a calculation only states the same terms
 * another way, and writing them out again for no saving gains nothing.
 *
 * @param  {string} resolved     The value the calculation resolved to.
 * @param  {string} calculation  The calculation, written as compactly as it can be.
 * @return {string}              Whichever of the two the value is written as.
 */
function chooseResolvedCalculation (resolved, calculation) {
  // A resolution that kept its function form left terms behind that only
  // resolve once the element they are measured against is laid out
  if (resolved.startsWith('calc(') && resolved.length >= calculation.length) {
    return calculation;
  }
  return shorterOfResolutionAndCalculation(resolved, calculation);
}

/**
 * Resolves a percentage divided by a number into the single percentage it
 * equals, which is how `calc(100%/16)` comes to be written as `6.25%`. The
 * division stays as it was written when the result is no shorter, and when
 * the divisor is zero, since that resolves to nothing a stylesheet can state.
 *
 * @param  {string}      expression  The contents of a `calc()`, with its whitespace collapsed.
 * @return {string|null}             The shorter of the resolved percentage and the division, or null when the expression is not one.
 */
function resolvePercentageDivision (expression) {
  const division = expression.match(PERCENTAGE_DIVISION);
  if (!division) {
    return null;
  }
  const [, percentage, divisor] = division;
  const calculation = 'calc(' + percentage + '%/' + divisor + ')';
  if (Number(divisor) === 0) {
    return calculation;
  }
  const resolved = formatResolvedNumber(Number(percentage) / Number(divisor)) + '%';
  return shorterOfResolutionAndCalculation(resolved, calculation);
}

/**
 * The properties whose values every CSS specification defines as
 * non-negative, so that a math function declared on one of them has its
 * result clamped rather than read as written.
 *
 * @type {Set<string>}
 */
const NON_NEGATIVE_PROPERTIES = new Set([
  'animation-duration',
  'animation-iteration-count',
  'background-size',
  'block-size',
  'border-block-end-width',
  'border-block-start-width',
  'border-block-width',
  'border-bottom-left-radius',
  'border-bottom-right-radius',
  'border-bottom-width',
  'border-end-end-radius',
  'border-end-start-radius',
  'border-image-outset',
  'border-image-width',
  'border-inline-end-width',
  'border-inline-start-width',
  'border-inline-width',
  'border-left-width',
  'border-radius',
  'border-right-width',
  'border-start-end-radius',
  'border-start-start-radius',
  'border-top-left-radius',
  'border-top-right-radius',
  'border-top-width',
  'border-width',
  'column-count',
  'column-gap',
  'column-rule-width',
  'column-width',
  'flex-basis',
  'flex-grow',
  'flex-shrink',
  'font-size',
  'gap',
  'height',
  'inline-size',
  'line-height',
  'mask-size',
  'max-block-size',
  'max-height',
  'max-inline-size',
  'max-width',
  'min-block-size',
  'min-height',
  'min-inline-size',
  'min-width',
  'outline-width',
  'padding',
  'padding-block',
  'padding-block-end',
  'padding-block-start',
  'padding-bottom',
  'padding-inline',
  'padding-inline-end',
  'padding-inline-start',
  'padding-left',
  'padding-right',
  'padding-top',
  'perspective',
  'row-gap',
  'shape-margin',
  'stroke-width',
  'tab-size',
  'transition-duration',
  'width'
]);

/**
 * Matches a value written as a single negative number, with or without the
 * unit or percent sign that follows its digits.
 *
 * @type {RegExp}
 */
const NEGATIVE_NUMBER_VALUE = /^-(?:\d+|\d*\.\d+)(?:[a-z]+|%)?$/i;

/**
 * Clamps what a math function resolved to into the range its property
 * accepts. A negative length written out directly makes the declaration
 * invalid and the CSS engine throws it away, but a math function is allowed
 * to resolve to one: its result is clamped to the nearest value the property
 * does take, which on a property that only accepts non-negative values is
 * zero, as the range checking section of the CSS Values specification
 * describes: https://drafts.csswg.org/css-values/#calc-range.
 *
 * @param  {string} resolvedValue  The value the math function resolved to.
 * @param  {string} property       The property the math function is declared on.
 * @return {string}                The resolved value, held inside the property's range.
 */
function clampResolvedValueToPropertyRange (resolvedValue, property) {
  const acceptsNegativeValues = !NON_NEGATIVE_PROPERTIES.has(String(property).toLowerCase());
  if (acceptsNegativeValues || !NEGATIVE_NUMBER_VALUE.test(resolvedValue)) {
    return resolvedValue;
  }
  return '0';
}

/**
 * Attempts to simplify a calc() expression by combining like-unit terms and evaluating pure arithmetic, returning the simplified string or null if folding is not possible.
 *
 * @param  {string}      expression  The expression inside calc() to attempt folding.
 * @return {string|null}             The simplified expression, or null if it cannot be folded.
 */
function tryFoldCalcExpression (expression) {
  let expr = expression.trim();
  let previous;

  do {
    previous = expr;
    // Remove innermost non-nested parentheses (flatten simple grouping)
    expr = expr.replace(/\(([^()]+)\)/g, '$1');
    // Fold: <number> * <number><unit> → computed result in same unit
    expr = expr.replace(/(-?(?:\d*\.\d+|\d+))\s*\*\s*(-?(?:\d*\.\d+|\d+))(px|pt|pc|in|cm|mm|q|%)/gi, (match, a, b, unit) => {
      return formatResolvedDimension(parseFloat(a) * parseFloat(b), unit);
    });
    // Fold: <number><unit> * <number> → computed result in same unit
    expr = expr.replace(/(-?(?:\d*\.\d+|\d+))(px|pt|pc|in|cm|mm|q|%)\s*\*\s*(-?(?:\d*\.\d+|\d+))/gi, (match, a, unit, b) => {
      return formatResolvedDimension(parseFloat(a) * parseFloat(b), unit);
    });
    // Fold: <number><unit> / <number> → computed result in same unit
    expr = expr.replace(/(-?(?:\d*\.\d+|\d+))(px|pt|pc|in|cm|mm|q)\s*\/\s*(-?(?:\d*\.\d+|\d+))/gi, (match, value, unit, divisor) => {
      return formatResolvedDimension(parseFloat(value) / parseFloat(divisor), unit);
    });
    // Collapse zero-with-unit terms (e.g. 0px, 0%) to plain 0 or remove them
    expr = expr.replace(/(^|[+-])\s*0(?:px|pt|pc|in|cm|mm|q|%)\b/g, (match, sign) => {
      if (sign && sign !== '+') {
        return sign + ' 0';
      }
      return '';
    });
    // Remove additive zero terms
    expr = expr.replace(/\+\s*0\b/g, '');
    // Remove subtractive zero terms
    expr = expr.replace(/-\s*0\b/g, '');
    // Collapse whitespace
    expr = expr.replace(/\s+/g, ' ').trim();
  } while (expr !== previous);

  // Simplify trivial identity division: 1 / 1 / <dimension> → <dimension>
  if (/^1\s*\/\s*1\s*\/\s*(-?(?:\d*\.\d+|\d+)(?:px|pt|pc|in|cm|mm|q))$/i.test(expr)) {
    return expr.replace(/^1\s*\/\s*1\s*\/\s*/i, '');
  }

  // Remove all whitespace for validation
  const normalized = expr.replace(/\s+/g, '');
  // Validate that the expression is a simple sequence of signed terms with optional units
  if (!/^[+-]?(?:\d*\.\d+|\d+)(?:[a-z%]+)?(?:[+-](?:\d*\.\d+|\d+)(?:[a-z%]+)?)*$/i.test(normalized)) {
    return null;
  }

  // Extract each signed term with its optional unit
  const terms = normalized.match(/[+-]?(?:\d*\.\d+|\d+)(?:[a-z%]+)?/gi) || [];
  const totals = new Map();

  for (const term of terms) {
    // Parse each term into sign, number, and unit parts
    const match = term.match(/^([+-]?)(\d*\.\d+|\d+)([a-z%]+)?$/i);
    if (!match) {
      return null;
    }
    const [, sign, rawNumber, rawUnit = ''] = match;
    let number = parseFloat(rawNumber) * (sign === '-' ? -1 : 1);
    let unit = rawUnit.toLowerCase();

    if (unit && unit !== '%' && unit !== 'px') {
      const pxValue = convertAbsoluteLengthToPx(number, unit);
      if (pxValue === null) {
        return null;
      }
      number = pxValue;
      unit = 'px';
    }

    totals.set(unit, (totals.get(unit) || 0) + number);
  }

  return formatUnitTotals(totals);
}

/**
 * Matches a whole expression that scales a percentage by a plain number,
 * written either way around. Both operands are already as short as they can
 * be, so the expression is only ever squeezed, never resolved.
 *
 * @type {RegExp}
 */
const PERCENTAGE_MULTIPLICATION = /^(?:-?(?:\d*\.\d+|\d+)%\s*\*\s*-?(?:\d*\.\d+|\d+)|-?(?:\d*\.\d+|\d+)\s*\*\s*-?(?:\d*\.\d+|\d+)%)$/;

/**
 * Matches a value that is a single percentage, which is all a calculation
 * leaves behind once every term of it has resolved into one.
 *
 * @type {RegExp}
 */
const RESOLVED_PERCENTAGE = /^-?(?:\d+|\d*\.\d+)%$/;

/**
 * Chooses how a calculation that shares a percentage out resolves. The
 * library states the result to the full precision a float carries, which is
 * both longer than the calculation it replaces and finer than a stylesheet
 * has any use for, so the result is rounded into the budget a resolved number
 * is written within and kept only when it is the shorter of the two.
 *
 * @param  {string} simplified    The result the calculation library returned.
 * @param  {string} compactInner  The contents of the `calc()`, with its whitespace collapsed.
 * @param  {string} match         The whole `calc()` as it was written.
 * @return {string}               How the resolved calculation is written.
 */
function chooseResolvedPercentage (simplified, compactInner, match) {
  // A division sign written after a percentage, which is what the resolved percentage was shared out by
  const dividesAPercentage = RESOLVED_PERCENTAGE.test(simplified) && /%\s*\//.test(match);
  if (!dividesAPercentage) {
    return simplified;
  }
  // Remove whitespace around division operator
  const calculation = 'calc(' + compactInner.replace(/\s*\/\s*/g, '/') + ')';
  const resolved = formatResolvedNumber(parseFloat(simplified)) + '%';
  return shorterOfResolutionAndCalculation(resolved, calculation);
}

/**
 * Resolves the contents of a `calc()` into the shortest way of writing the
 * same value, which is either the value the arithmetic works out to or the
 * calculation itself with the whitespace squeezed out of it.
 *
 * @param  {string} match         The whole `calc()` as it was written.
 * @param  {string} compactInner  The contents of the `calc()`, with its whitespace collapsed.
 * @return {string}               The shortest way of writing what the calculation states.
 */
function resolveCalcExpression (match, compactInner) {
  if (PERCENTAGE_MULTIPLICATION.test(compactInner)) {
    return compactCalculation(compactInner);
  }

  const dividedPercentage = resolvePercentageDivision(compactInner);
  if (dividedPercentage) {
    return dividedPercentage;
  }

  const folded = tryFoldCalcExpression(compactInner);
  if (folded) {
    return folded;
  }

  const simplified = simplifyCalc(match);
  if (simplified === null) {
    return match;
  }
  const resolved = chooseResolvedPercentage(simplified, compactInner, match);
  return chooseResolvedCalculation(resolved, compactCalculation(compactInner));
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
  let result = rewriteMathFunctionContents(convertReciprocalMultiplicationToDivision, value);

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
  let previous;

  do {
    previous = result;
    // Resolving a math function leaves a plain value where it stood, which can
    // bring the function it was nested in within reach of the next pass, so
    // the value is simplified until it settles
    result = simplifyMathFunctionsOnce(result, property);
  } while (result !== previous);

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
 * Simplifies a standalone calc() value by resolving its arithmetic, flattening nested calc expressions, converting absolute length units to pixels, and folding constant terms.
 *
 * @param  {string} value  The CSS value string, already known to be a single `calc()`.
 * @return {string}        The simplified value, or the original value if simplification is not applicable.
 */
function foldStandaloneCalc (value) {
  let inner = value.slice(5, -1).trim();

  // Preserve percent-times-number expressions, only stripping whitespace around operators
  if (PERCENTAGE_MULTIPLICATION.test(inner.replace(/\s+/g, ' ').trim())) {
    return compactCalculation(inner);
  }

  // Resolve the calculation as it was written, which is the only reading of it
  // that keeps the grouping its parentheses state. Everything below reads a
  // flattened copy of the expression, where that grouping is already gone.
  const resolved = simplifyCalc(value);
  if (resolved !== null) {
    return chooseResolvedCalculation(resolved, compactCalculation(inner));
  }

  // If no nested function calls and no multiplication/division involving parens, try flattening
  if (!/[A-Za-z-]+\(/.test(inner) && !/[*/]\s*\(|\)\s*[*/]/.test(inner)) {
    // Remove all parentheses and collapse whitespace for folding
    const flattened = inner.replace(/[()]/g, '').replace(/\s+/g, ' ').trim();
    const foldedFlattened = tryFoldCalcExpression(flattened);
    if (foldedFlattened) {
      return foldedFlattened;
    }
  }

  let previous;

  do {
    previous = inner;
    // Fold innermost parenthesized sub-expressions that aren't function calls
    inner = inner.replace(/(^|[^A-Za-z-])\(([^()]+)\)/g, (match, prefix, content) => {
      const trimmed = content.trim();
      const folded = tryFoldCalcExpression(trimmed);
      if (folded) {
        if (folded.startsWith('calc(') && folded.endsWith(')')) {
          return prefix + trimmed;
        }
        return prefix + folded;
      }
      return prefix + trimmed;
    });
  } while (inner !== previous);

  const folded = tryFoldCalcExpression(inner);
  if (folded) {
    return folded;
  }

  // Collapse whitespace and check for percent-division expressions
  const dividedPercentage = resolvePercentageDivision(inner.replace(/\s+/g, ' ').trim());
  if (dividedPercentage) {
    return dividedPercentage;
  }

  return compactCalculation(inner);
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

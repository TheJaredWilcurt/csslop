/**
 * @file Simplifies CSS math functions (calc, min, max) by folding constant expressions, flattening nested calcs, and converting absolute lengths to pixels.
 */

import { calc } from '@csstools/css-calc';

import {
  convertAbsoluteLengthToPx,
  formatDimension,
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
 * The functions whose arguments are a math expression, where `*` and `/` are
 * arithmetic operators rather than characters of some other syntax.
 *
 * @type {Set<string>}
 */
const MATH_FUNCTION_NAMES = new Set([
  'abs',
  'calc',
  'clamp',
  'hypot',
  'max',
  'min',
  'mod',
  'rem',
  'round',
  'sign'
]);

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
 * Finds the parenthesis closing the one at the given index.
 *
 * @param  {string} value      The CSS value string being scanned.
 * @param  {number} openIndex  The index of the opening parenthesis.
 * @return {number}            The index of the matching closing parenthesis, or -1 when it never closes.
 */
function findClosingParenthesis (value, openIndex) {
  let depth = 0;
  for (let index = openIndex; index < value.length; index++) {
    if (value[index] === '(') {
      depth++;
    } else if (value[index] === ')') {
      depth--;
      if (depth === 0) {
        return index;
      }
    }
  }
  return -1;
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
    const closeIndex = findClosingParenthesis(value, openIndex);
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
 * The units a folded calc() expression leads with, in the order they are
 * written. Every other unit follows them alphabetically.
 *
 * @type {Array}
 */
const PREFERRED_UNIT_ORDER = ['%', '', 'px'];

/**
 * The same leading units, for excluding them from the alphabetical remainder.
 *
 * @type {Set<string>}
 */
const PREFERRED_UNITS = new Set(PREFERRED_UNIT_ORDER);

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
      return formatDimension(parseFloat(a) * parseFloat(b), unit);
    });
    // Fold: <number><unit> * <number> → computed result in same unit
    expr = expr.replace(/(-?(?:\d*\.\d+|\d+))(px|pt|pc|in|cm|mm|q|%)\s*\*\s*(-?(?:\d*\.\d+|\d+))/gi, (match, a, unit, b) => {
      return formatDimension(parseFloat(a) * parseFloat(b), unit);
    });
    // Fold: <number><unit> / <number> → computed result in same unit
    expr = expr.replace(/(-?(?:\d*\.\d+|\d+))(px|pt|pc|in|cm|mm|q)\s*\/\s*(-?(?:\d*\.\d+|\d+))/gi, (match, value, unit, divisor) => {
      return formatDimension(parseFloat(value) / parseFloat(divisor), unit);
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

  const orderedUnits = [...PREFERRED_UNIT_ORDER, ...[...totals.keys()].filter((unit) => {
    return !PREFERRED_UNITS.has(unit);
  }).sort()];
  const outputTerms = [];

  for (const unit of orderedUnits) {
    if (!totals.has(unit)) {
      continue;
    }
    const value = totals.get(unit);
    if (Math.abs(value) < 1e-12) {
      continue;
    }
    outputTerms.push({ unit, value });
  }

  if (!outputTerms.length) {
    return '0';
  }

  if (outputTerms.length === 1) {
    const { unit, value } = outputTerms[0];
    if (unit) {
      return roundCompactNumber(value) + unit;
    }
    return roundCompactNumber(value);
  }

  const [first, ...rest] = outputTerms;
  let result = roundCompactNumber(first.value) + first.unit;
  for (const term of rest) {
    const sign = term.value < 0 ? '-' : '+';
    result += ' ' + sign + ' ' + roundCompactNumber(Math.abs(term.value)) + term.unit;
  }
  return 'calc(' + result + ')';
}

/**
 * Simplifies calc(), min(), and max() expressions within a CSS value string using the `@csstools`/css-calc library, falling back to the original value on failure.
 *
 * @param  {string} value          The CSS value string containing math functions to simplify.
 * @param  {string} property       The CSS property name, used for context-aware simplification.
 * @param  {string} originalValue  The original unmodified value to fall back to if simplification produces an invalid result.
 * @return {string}                The value with math functions simplified where possible.
 */
function normalizeMathFunctions (value, property, originalValue = '') {
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

  // Simplify min()/max() expressions using @csstools/css-calc
  result = result.replace(/\b(min|max)\(([^()]+)\)/gi, keepSeparatorAfterDissolvedFunction((match) => {
    try {
      const simplified = calc(match);
      return typeof simplified === 'string' ? simplified : match;
    } catch {
      return match;
    }
  }));

  // Simplify calc() expressions using constant folding and @csstools/css-calc
  result = result.replace(/calc\(([^()]+)\)/gi, keepSeparatorAfterDissolvedFunction((match, inner) => {
    // Collapse whitespace inside calc expression
    const compactInner = inner.replace(/\s+/g, ' ').trim();
    // Preserve percent-times-number expressions (e.g. 50%*2 or 2*50%) — just strip inner spaces
    if (/^(?:-?(?:\d*\.\d+|\d+)%\s*\*\s*-?(?:\d*\.\d+|\d+)|-?(?:\d*\.\d+|\d+)\s*\*\s*-?(?:\d*\.\d+|\d+)%)$/i.test(compactInner)) {
      // Remove whitespace around multiplication/division operators
      return 'calc(' + compactInner.replace(/\s*([*/])\s*/g, '$1') + ')';
    }
    // Preserve percent/number division expressions (e.g. 100%/3) — just strip inner spaces
    if (/^\d+(?:\.\d+)?%\s*\/\s*\d+(?:\.\d+)?$/i.test(compactInner)) {
      // Remove whitespace around division operator
      return 'calc(' + compactInner.replace(/\s*\/\s*/g, '/') + ')';
    }

    const folded = tryFoldCalcExpression(compactInner);
    if (folded) {
      return folded;
    }

    try {
      const simplified = calc(match);
      if (typeof simplified !== 'string') {
        return match;
      }
      // If simplified to a bare percentage but original had division, preserve the calc form
      if (/^-?(?:\d+|\d*\.\d+)%$/.test(simplified) && /%\s*\//.test(match)) {
        return 'calc(' + compactInner.replace(/\s*\/\s*/g, '/') + ')';
      }
      return simplified;
    } catch {
      return match;
    }
  }));

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

  // Round results with excessive decimal places (4+ digits after the decimal)
  result = result.replace(/(-?(?:\d+|\d*\.\d+)\.\d{4,})([a-z%]+)/gi, (match, number, unit) => {
    return roundCompactNumber(number) + unit;
  });
  return result;
}

/**
 * Simplifies a standalone calc() value by flattening nested calc expressions, converting absolute length units to pixels, and folding constant terms.
 *
 * @param  {string} value  The CSS value string that may be a standalone calc() expression.
 * @return {string}        The simplified value, or the original value if simplification is not applicable.
 */
function simplifyStandaloneCalc (value) {
  // Check if value starts with calc( and ends with )
  if (!/^calc\(/i.test(value) || !value.endsWith(')')) {
    return value;
  }
  let inner = value.slice(5, -1).trim();

  // Preserve percent-times-number expressions, only stripping whitespace around operators
  if (/^(?:-?(?:\d*\.\d+|\d+)%\s*\*\s*-?(?:\d*\.\d+|\d+)|-?(?:\d*\.\d+|\d+)\s*\*\s*-?(?:\d*\.\d+|\d+)%)$/i.test(inner.replace(/\s+/g, ' ').trim())) {
    return 'calc(' + inner.replace(/\s*([*/])\s*/g, '$1') + ')';
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
  const compactInner = inner.replace(/\s+/g, ' ').trim();
  // Preserve percent/number division, just strip whitespace around the operator
  if (/^\d+(?:\.\d+)?%\s*\/\s*\d+(?:\.\d+)?$/i.test(compactInner)) {
    return 'calc(' + compactInner.replace(/\s*\/\s*/g, '/') + ')';
  }

  // Default: strip whitespace around multiplication/division operators
  return 'calc(' + compactInner.replace(/\s*([*/])\s*/g, '$1') + ')';
}

export {
  normalizeMathFunctions,
  simplifyStandaloneCalc
};

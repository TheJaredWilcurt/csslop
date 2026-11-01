/**
 * @file Folds the constant arithmetic of a `calc()` into the shortest way of writing the value it states, weighing the resolved value against the calculation itself.
 */

import {
  convertAbsoluteLengthToPx,
  formatResolvedDimension,
  formatResolvedNumber
} from '../shared.js';

import { simplifyCalc } from './evaluate.js';
import { formatUnitTotals } from './format.js';

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
 * Attempts to simplify a calc() expression by combining like-unit terms and evaluating pure arithmetic, returning the simplified string or null if folding is not possible.
 *
 * @param  {string}      expression  The expression inside calc() to attempt folding.
 * @return {string|null}             The simplified expression, or null if it cannot be folded.
 */
function tryFoldCalcExpression (expression) {
  let folded = expression.trim();
  let previous;

  do {
    previous = folded;
    // Remove innermost non-nested parentheses (flatten simple grouping)
    folded = folded.replace(/\(([^()]+)\)/g, '$1');
    // Fold: <number> * <number><unit> → computed result in same unit
    folded = folded.replace(/(-?(?:\d*\.\d+|\d+))\s*\*\s*(-?(?:\d*\.\d+|\d+))(px|pt|pc|in|cm|mm|q|%)/gi, (match, multiplier, amount, unit) => {
      return formatResolvedDimension(parseFloat(multiplier) * parseFloat(amount), unit);
    });
    // Fold: <number><unit> * <number> → computed result in same unit
    folded = folded.replace(/(-?(?:\d*\.\d+|\d+))(px|pt|pc|in|cm|mm|q|%)\s*\*\s*(-?(?:\d*\.\d+|\d+))/gi, (match, amount, unit, multiplier) => {
      return formatResolvedDimension(parseFloat(multiplier) * parseFloat(amount), unit);
    });
    // Fold: <number><unit> / <number> → computed result in same unit
    folded = folded.replace(/(-?(?:\d*\.\d+|\d+))(px|pt|pc|in|cm|mm|q)\s*\/\s*(-?(?:\d*\.\d+|\d+))/gi, (match, value, unit, divisor) => {
      return formatResolvedDimension(parseFloat(value) / parseFloat(divisor), unit);
    });
    // Collapse zero-with-unit terms (e.g. 0px, 0%) to plain 0 or remove them
    folded = folded.replace(/(^|[+-])\s*0(?:px|pt|pc|in|cm|mm|q|%)\b/g, (match, sign) => {
      if (sign && sign !== '+') {
        return sign + ' 0';
      }
      return '';
    });
    // Remove additive zero terms
    folded = folded.replace(/\+\s*0\b/g, '');
    // Remove subtractive zero terms
    folded = folded.replace(/-\s*0\b/g, '');
    // Collapse whitespace
    folded = folded.replace(/\s+/g, ' ').trim();
  } while (folded !== previous);

  // Simplify trivial identity division: 1 / 1 / <dimension> → <dimension>
  if (/^1\s*\/\s*1\s*\/\s*(-?(?:\d*\.\d+|\d+)(?:px|pt|pc|in|cm|mm|q))$/i.test(folded)) {
    return folded.replace(/^1\s*\/\s*1\s*\/\s*/i, '');
  }

  // Remove all whitespace for validation
  const normalized = folded.replace(/\s+/g, '');
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

export {
  foldStandaloneCalc,
  resolveCalcExpression
};

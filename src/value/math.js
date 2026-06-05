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
 * Attempts to simplify a calc() expression by combining like-unit terms and evaluating pure arithmetic, returning the simplified string or null if folding is not possible.
 *
 * @param  {string}      expression  The expression inside calc() to attempt folding.
 * @return {string|null}             The simplified expression, or null if it cannot be folded.
 */
function tryFoldCalcExpression (expression) {
  let foldedExpression = expression.trim();
  let previous;

  do {
    previous = foldedExpression;
    // Remove innermost non-nested parentheses (flatten simple grouping)
    foldedExpression = foldedExpression.replace(/\(([^()]+)\)/g, '$1');
    // Fold: <number> * <number><unit> → computed result in same unit
    foldedExpression = foldedExpression.replace(/(-?(?:\d*\.\d+|\d+))\s*\*\s*(-?(?:\d*\.\d+|\d+))(px|pt|pc|in|cm|mm|q|%)/gi, (match, leftOperand, rightOperand, unit) => {
      return formatDimension(parseFloat(leftOperand) * parseFloat(rightOperand), unit);
    });
    // Fold: <number><unit> * <number> → computed result in same unit
    foldedExpression = foldedExpression.replace(/(-?(?:\d*\.\d+|\d+))(px|pt|pc|in|cm|mm|q|%)\s*\*\s*(-?(?:\d*\.\d+|\d+))/gi, (match, leftOperand, unit, rightOperand) => {
      return formatDimension(parseFloat(leftOperand) * parseFloat(rightOperand), unit);
    });
    // Fold: <number><unit> / <number> → computed result in same unit
    foldedExpression = foldedExpression.replace(/(-?(?:\d*\.\d+|\d+))(px|pt|pc|in|cm|mm|q)\s*\/\s*(-?(?:\d*\.\d+|\d+))/gi, (match, value, unit, divisor) => {
      return formatDimension(parseFloat(value) / parseFloat(divisor), unit);
    });
    // Collapse zero-with-unit terms (e.g. 0px, 0%) to plain 0 or remove them
    foldedExpression = foldedExpression.replace(/(^|[+-])\s*0(?:px|pt|pc|in|cm|mm|q|%)\b/g, (match, sign) => {
      if (sign && sign !== '+') {
        return sign + ' 0';
      }
      return '';
    });
    // Remove additive zero terms
    foldedExpression = foldedExpression.replace(/\+\s*0\b/g, '');
    // Remove subtractive zero terms
    foldedExpression = foldedExpression.replace(/-\s*0\b/g, '');
    // Collapse whitespace
    foldedExpression = foldedExpression.replace(/\s+/g, ' ').trim();
  } while (foldedExpression !== previous);

  // Simplify trivial identity division: 1 / 1 / <dimension> → <dimension>
  if (/^1\s*\/\s*1\s*\/\s*(-?(?:\d*\.\d+|\d+)(?:px|pt|pc|in|cm|mm|q))$/i.test(foldedExpression)) {
    return foldedExpression.replace(/^1\s*\/\s*1\s*\/\s*/i, '');
  }

  // Remove all whitespace for validation
  const normalized = foldedExpression.replace(/\s+/g, '');
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

  const orderedUnits = ['%', '', 'px', ...[...totals.keys()].filter((unit) => {
    return !['%', '', 'px'].includes(unit);
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
  let result = value;

  // Unwrap calc(1 / (1 / x)) → x (double-reciprocal identity)
  result = result.replace(/calc\(\s*1\s*\/\s*\(\s*1\s*\/\s*([^()]+)\s*\)\s*\)/gi, (match, inner) => {
    return inner.trim();
  });
  // Flatten calc(calc(a) ± b) → calc(a ± b)
  result = result.replace(/calc\(\s*calc\(([^()]+)\)\s*([+-])\s*([^()]+)\s*\)/gi, (match, inner, operator, tail) => {
    return 'calc(' + inner + ' ' + operator + ' ' + tail + ')';
  });
  // Unwrap calc(calc(x)) → calc(x)
  result = result.replace(/calc\(\s*calc\(([^()]+)\)\s*\)/gi, (match, inner) => {
    return 'calc(' + inner + ')';
  });

  // Simplify min()/max() expressions using @csstools/css-calc
  result = result.replace(/\b(min|max)\(([^()]+)\)/gi, (match) => {
    try {
      const simplified = calc(match);
      return typeof simplified === 'string' ? simplified : match;
    } catch {
      return match;
    }
  });

  // Simplify calc() expressions using constant folding and @csstools/css-calc
  result = result.replace(/calc\(([^()]+)\)/gi, (match, inner) => {
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
  });

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

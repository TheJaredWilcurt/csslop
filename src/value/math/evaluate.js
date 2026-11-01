/**
 * @file Reads the arithmetic a CSS math function states and resolves it into the value it works out to, whenever every operand of it is a number already known at minification time.
 */

import { formatUnitTotals } from './format.js';
import { parseSum } from './parser.js';
import { tokenizeMathExpression } from './tokenizer.js';

/**
 * Resolves a CSS math function into the value its arithmetic works out to.
 * A function whose operands are not all known at minification time — one
 * referencing a custom property, an environment variable, or an element the
 * value is only resolved against once the page is laid out — states a value
 * that cannot be worked out here, and so resolves to nothing.
 *
 * @param  {string}      mathFunction  The math function as it is written, such as `calc(10 / 2)` or `min(10px, 20px)`.
 * @return {string|null}               The value the math function states, or null when it cannot be resolved.
 */
function simplifyCalc (mathFunction) {
  const tokens = tokenizeMathExpression(mathFunction);
  if (!tokens) {
    return null;
  }
  const reader = { tokens, index: 0, depth: 0 };
  const totals = parseSum(reader);
  // A token left unread means the expression states more than the arithmetic
  // that was resolved, so what was resolved is not the whole of its value
  if (!totals || reader.index !== tokens.length) {
    return null;
  }
  return formatUnitTotals(totals);
}

export {
  simplifyCalc
};

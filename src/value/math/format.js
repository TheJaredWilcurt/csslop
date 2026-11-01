/**
 * @file Writes the unit totals a calculation resolved to as the shortest CSS value that states them.
 */

import { formatResolvedNumber } from '../shared.js';

import { PERCENTAGE } from './unit-totals.js';

/**
 * The smallest total a term is written with. A term totalling less than this
 * is the rounding error binary floating point arithmetic leaves behind rather
 * than a quantity the stylesheet states.
 *
 * @type {number}
 */
const NEGLIGIBLE_TOTAL = 1e-12;

/**
 * The unit each kind of quantity is canonically stated in, and how much of
 * that unit one of the unit written measures. Absolute lengths are absent
 * because every length is already totalled in the pixels it measures.
 *
 * @type {Map<string, {unit: string, perUnit: number}>}
 */
const CANONICAL_UNITS = new Map([
  ['s', { unit: 's', perUnit: 1 }],
  ['ms', { unit: 's', perUnit: 1 / 1000 }],
  ['deg', { unit: 'deg', perUnit: 1 }],
  ['grad', { unit: 'deg', perUnit: 360 / 400 }],
  ['rad', { unit: 'deg', perUnit: 180 / Math.PI }],
  ['turn', { unit: 'deg', perUnit: 360 }],
  ['hz', { unit: 'hz', perUnit: 1 }],
  ['khz', { unit: 'hz', perUnit: 1000 }],
  ['dppx', { unit: 'dppx', perUnit: 1 }],
  ['x', { unit: 'dppx', perUnit: 1 }],
  ['dpi', { unit: 'dppx', perUnit: 1 / 96 }],
  ['dpcm', { unit: 'dppx', perUnit: 2.54 / 96 }]
]);

/**
 * Counts how many units of each kind of quantity a calculation totalled, so
 * that the kinds it states in more than one unit can be told from the ones it
 * states in a single unit.
 *
 * @param  {Map} totals  The unit totals the calculation resolved to.
 * @return {Map}         How many units each canonical unit was totalled from.
 */
function countUnitsByKind (totals) {
  const counts = new Map();
  for (const unit of totals.keys()) {
    const conversion = CANONICAL_UNITS.get(unit);
    if (!conversion) {
      continue;
    }
    counts.set(conversion.unit, (counts.get(conversion.unit) || 0) + 1);
  }
  return counts;
}

/**
 * Restates the totals of every kind of quantity a calculation measured in two
 * units of, so that terms measuring the same thing are totalled together
 * (`calc(1s - 200ms)` comes to `.8s`). A kind measured in a single unit keeps
 * that unit: restating `2ms` as `.002s` measures the same time in more
 * characters than it was written with.
 *
 * @param  {Map} totals  The unit totals the calculation resolved to.
 * @return {Map}         The totals, with each kind of quantity stated in one unit.
 */
function mergeUnitsOfSameKind (totals) {
  const unitCounts = countUnitsByKind(totals);
  const measuredInSeveralUnits = [...unitCounts.values()].some((count) => {
    return count > 1;
  });
  if (!measuredInSeveralUnits) {
    return totals;
  }
  const merged = new Map();
  for (const [unit, total] of totals) {
    const conversion = CANONICAL_UNITS.get(unit);
    const restatesUnit = conversion && unitCounts.get(conversion.unit) > 1;
    const mergedUnit = restatesUnit ? conversion.unit : unit;
    const mergedTotal = restatesUnit ? total * conversion.perUnit : total;
    merged.set(mergedUnit, (merged.get(mergedUnit) || 0) + mergedTotal);
  }
  return merged;
}

/**
 * Collects the terms a resolved calculation is written from, leaving out the
 * ones that totalled to nothing. A unit is totalled from where it is first
 * written, so the terms keep the order the calculation states them in, which
 * is both the order the author chose and one fewer difference between what
 * was written and what is written back out.
 *
 * @param  {Map}   totals  The unit totals the calculation resolved to.
 * @return {Array}         The terms to write, each holding its unit and its total.
 */
function collectOutputTerms (totals) {
  const terms = [];
  for (const [unit, total] of totals) {
    if (Math.abs(total) < NEGLIGIBLE_TOTAL) {
      continue;
    }
    terms.push({ total, unit });
  }
  return leadWithAddedTerm(terms);
}

/**
 * Moves an added term to the front of a calculation that a subtracted one
 * leads. Every term but the first is written after the operator adding or
 * subtracting it, so a term written first states its own sign, and the minus
 * sign of a subtracted one is a character the sum saves by being led by a
 * term that is added instead.
 *
 * @param  {Array} terms  The terms to write, in the order the calculation states them.
 * @return {Array}        The same terms, led by one that is added whenever any of them is.
 */
function leadWithAddedTerm (terms) {
  if (!terms.length || terms[0].total > 0) {
    return terms;
  }
  const leadingIndex = terms.findIndex((term) => {
    return term.total > 0;
  });
  if (leadingIndex === -1) {
    return terms;
  }
  const reordered = [...terms];
  const [addedTerm] = reordered.splice(leadingIndex, 1);
  reordered.unshift(addedTerm);
  return reordered;
}

/**
 * Reports whether writing only the terms collected would drop a percentage the
 * calculation was written with. A percentage that cancels out still ties the
 * value to the basis the percentage is resolved against, so a calculation
 * keeping other terms cannot be written without it.
 *
 * @param  {Map}     totals       The unit totals the calculation resolved to.
 * @param  {Array}   outputTerms  The terms that would be written.
 * @return {boolean}              Whether a percentage the calculation states would be lost.
 */
function dropsPercentageBasis (totals, outputTerms) {
  if (!totals.has(PERCENTAGE) || !outputTerms.length) {
    return false;
  }
  return !outputTerms.some((term) => {
    return term.unit === PERCENTAGE;
  });
}

/**
 * Writes the total of a term as the number a stylesheet states it with. A
 * total that no written number states faithfully — one that is infinite, one
 * beyond the integers a double holds exactly, and one that rounds away to
 * nothing — has no number to be written as.
 *
 * @param  {number}      total  The total the term resolved to.
 * @return {string|null}        The number as it is written into the stylesheet, or null when it cannot be written.
 */
function writeTermNumber (total) {
  if (!Number.isFinite(total) || Math.abs(total) > Number.MAX_SAFE_INTEGER) {
    return null;
  }
  const written = formatResolvedNumber(total);
  const roundsAwayToNothing = total !== 0 && parseFloat(written) === 0;
  if (roundsAwayToNothing) {
    return null;
  }
  return written;
}

/**
 * Writes the unit totals a calculation resolved to as the shortest value
 * stating them: the lone quantity they came to, or, when units that only
 * resolve against the element are left over, a `calc()` summing what remains.
 *
 * @param  {Map}         totals  The unit totals the calculation resolved to.
 * @return {string|null}         The value the calculation resolved to, or null when it cannot be written faithfully.
 */
function formatUnitTotals (totals) {
  const writtenQuantity = totals.writtenQuantity;
  if (
    writtenQuantity &&
    totals.size === 1 &&
    totals.has(writtenQuantity.canonicalUnit) &&
    totals.get(writtenQuantity.canonicalUnit) === writtenQuantity.canonicalNumber
  ) {
    return formatResolvedNumber(writtenQuantity.number) + writtenQuantity.unit;
  }
  const mergedTotals = mergeUnitsOfSameKind(totals);
  const hasUnrepresentableReciprocalUnit = [...mergedTotals.keys()].some((unit) => {
    return unit.startsWith('reciprocal:');
  });
  if (hasUnrepresentableReciprocalUnit) {
    return null;
  }
  const outputTerms = collectOutputTerms(mergedTotals);
  if (dropsPercentageBasis(mergedTotals, outputTerms)) {
    return null;
  }
  if (!outputTerms.length) {
    return '0';
  }
  const [leadingTerm, ...trailingTerms] = outputTerms;
  const leadingNumber = writeTermNumber(leadingTerm.total);
  if (leadingNumber === null) {
    return null;
  }
  let written = leadingNumber + leadingTerm.unit;
  for (const term of trailingTerms) {
    const number = writeTermNumber(Math.abs(term.total));
    if (number === null) {
      return null;
    }
    // Both operators have to be surrounded by whitespace to be read as one
    written = written + (term.total < 0 ? ' - ' : ' + ') + number + term.unit;
  }
  if (trailingTerms.length) {
    return 'calc(' + written + ')';
  }
  return written;
}

export {
  formatUnitTotals
};

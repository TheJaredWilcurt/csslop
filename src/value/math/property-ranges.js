/**
 * @file Holds what a math function resolved to inside the range of values the property it is declared on accepts.
 */

import { formatResolvedNumber } from '../shared.js';

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
 * Properties whose computed math values must be integers.
 *
 * @type {Set<string>}
 */
const INTEGER_VALUE_PROPERTIES = new Set([
  'column-count',
  'order',
  'orphans',
  'widows',
  'z-index'
]);

/**
 * The inclusive bounds that CSS applies to numeric property values after
 * resolving a math expression.
 *
 * @type {Map<string, {minimum?: number, maximum?: number}>}
 */
const NUMERIC_PROPERTY_RANGES = new Map([
  ['column-count', { minimum: 1 }],
  ['opacity', { minimum: 0, maximum: 1 }]
]);

/**
 * Matches a value written as a single negative number, with or without the
 * unit or percent sign that follows its digits.
 *
 * @type {RegExp}
 */
const NEGATIVE_NUMBER_VALUE = /^-(?:\d+|\d*\.\d+)(?:[a-z]+|%)?$/i;

/**
 * Matches a resolved unitless number whose value can be rounded or clamped by
 * a property's numeric range.
 *
 * @type {RegExp}
 */
const UNIT_LESS_NUMBER_VALUE = /^[+-]?(?:\d+|\d*\.\d+)$/;

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
  const normalizedProperty = String(property).toLowerCase();
  const acceptsNegativeValues = !NON_NEGATIVE_PROPERTIES.has(normalizedProperty);
  const hasPropertyRange = NUMERIC_PROPERTY_RANGES.has(normalizedProperty);
  const range = NUMERIC_PROPERTY_RANGES.get(normalizedProperty) || {};
  const isNegativeNonNegativeValue = !acceptsNegativeValues && NEGATIVE_NUMBER_VALUE.test(resolvedValue);
  if (isNegativeNonNegativeValue) {
    const isUnitlessNumber = UNIT_LESS_NUMBER_VALUE.test(resolvedValue);
    if (!isUnitlessNumber) {
      return formatResolvedNumber(range.minimum === undefined ? 0 : range.minimum);
    }
    if (!hasPropertyRange && !INTEGER_VALUE_PROPERTIES.has(normalizedProperty)) {
      return '0';
    }
  }
  if (!hasPropertyRange && !INTEGER_VALUE_PROPERTIES.has(normalizedProperty)) {
    return resolvedValue;
  }
  if (!UNIT_LESS_NUMBER_VALUE.test(resolvedValue)) {
    return resolvedValue;
  }

  const shouldRoundToInteger = INTEGER_VALUE_PROPERTIES.has(normalizedProperty);
  let numericValue = Number(resolvedValue);
  if (shouldRoundToInteger) {
    numericValue = Math.round(numericValue);
  }
  if (range.minimum !== undefined) {
    numericValue = Math.max(range.minimum, numericValue);
  }
  if (range.maximum !== undefined) {
    numericValue = Math.min(range.maximum, numericValue);
  }
  return formatResolvedNumber(numericValue);
}

export {
  clampResolvedValueToPropertyRange
};

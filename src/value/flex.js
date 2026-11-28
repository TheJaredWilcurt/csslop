/**
 * @file Parses and serializes the `flex` shorthand, writing its grow, shrink, and basis components in the shortest form that reads back the same.
 */

import { splitTopLevelComponents } from '../parser/source-search.js';

/**
 * Matches a unitless number, which a `flex` shorthand reads as a grow or shrink
 * factor rather than as a basis. Optional leading digits are allowed, so `.5`
 * and `2` both match.
 *
 * @type {RegExp}
 */
const UNITLESS_NUMBER_PATTERN = /^(?:\d*\.)?\d+$/;

/**
 * Matches a zero flex basis, written unitless, as a percentage, or as zero
 * pixels. The shorthand reads an omitted basis as this zero basis.
 *
 * @type {RegExp}
 */
const ZERO_BASIS_PATTERN = /^0(?:%|px)?$/;

/**
 * Determines whether a flex component is a unitless number.
 *
 * @param  {string}  component  A single top-level component of a `flex` value.
 * @return {boolean}            Whether the component is a unitless number.
 */
function isUnitlessNumber (component) {
  return UNITLESS_NUMBER_PATTERN.test(component);
}

/**
 * Reads a `flex` value into its grow, shrink, and basis components, filling in
 * the components the shorthand leaves out with their defaults. A value that
 * uses a function or an `!important` suffix is left for the caller to keep as
 * written.
 *
 * @param  {string}     value  The `flex` value.
 * @return {Array|null}        The `[grow, shrink, basis]` components, or null when the value cannot be read.
 */
function parseFlexComponents (value) {
  const parts = splitTopLevelComponents(value);
  if (parts.some((part) => {
    return part.includes('(') || part.includes('!');
  })) {
    return null;
  }
  if (parts.length === 1) {
    const [onlyPart] = parts;
    if (onlyPart === 'none') {
      return ['0', '0', 'auto'];
    }
    if (onlyPart === 'auto') {
      return ['1', '1', 'auto'];
    }
    if (isUnitlessNumber(onlyPart)) {
      return [onlyPart, '1', '0%'];
    }
    return ['1', '1', onlyPart];
  }
  if (parts.length === 2) {
    const [first, second] = parts;
    if (!isUnitlessNumber(first)) {
      return null;
    }
    if (isUnitlessNumber(second)) {
      return [first, second, '0%'];
    }
    return [first, '1', second];
  }
  if (parts.length === 3 && isUnitlessNumber(parts[0]) && isUnitlessNumber(parts[1])) {
    return parts;
  }
  return null;
}

/**
 * Writes grow, shrink, and basis as the shortest `flex` value that reads back
 * the same components. A shrink of `1` and a zero basis are both defaults that
 * are left out, and a grow of `1` with a shrink of `1` is written as the basis
 * alone.
 *
 * @param  {string} grow    The flex-grow component.
 * @param  {string} shrink  The flex-shrink component.
 * @param  {string} basis   The flex-basis component.
 * @return {string}         The shortest `flex` value for the components.
 */
function serializeFlexComponents (grow, shrink, basis) {
  if (grow === '0' && shrink === '0' && basis === 'auto') {
    return 'none';
  }
  const hasDefaultShrink = shrink === '1';
  if (ZERO_BASIS_PATTERN.test(basis)) {
    return hasDefaultShrink ? grow : grow + ' ' + shrink;
  }
  if (grow === '1' && hasDefaultShrink) {
    return basis;
  }
  if (hasDefaultShrink) {
    return grow + ' ' + basis;
  }
  return [grow, shrink, basis].join(' ');
}

/**
 * Matches a trailing `!important` flag, which is kept as written after the
 * minified components.
 *
 * @type {RegExp}
 */
const IMPORTANT_FLAG_PATTERN = /!important$/i;

/**
 * Minifies a `flex` value by reading it into its components and writing them
 * back in the shortest form. A trailing `!important` flag is kept as it is. A
 * value that cannot be read is returned unchanged.
 *
 * @param  {string} value  The `flex` value.
 * @return {string}        The minified value.
 */
function minifyFlexValue (value) {
  const importantFlag = value.match(IMPORTANT_FLAG_PATTERN)?.[0] ?? '';
  const flexValue = value.slice(0, value.length - importantFlag.length).trim();
  const components = parseFlexComponents(flexValue);
  if (!components) {
    return value;
  }
  return serializeFlexComponents(...components) + importantFlag;
}

export {
  minifyFlexValue,
  serializeFlexComponents
};

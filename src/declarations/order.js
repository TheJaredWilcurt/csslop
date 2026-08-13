/**
 * @file Orders declarations within a rule so that shorthands stay ahead of the longhands they reset.
 */

import {
  shorthandMap,
  shorthandOverrideMap
} from './config.js';

/**
 * Pairs of properties where the first must be emitted before the second, because
 * the first resets the second and a merged shorthand is appended after the
 * longhands it was built from.
 *
 * @type {Array}
 */
const REQUIRED_PROPERTY_ORDER = [
  ['border', 'border-image'],
  ['font', 'font-feature-settings'],
  ['font', 'font-variant-ligatures'],
  ['font', 'font-kerning'],
  ['font', 'font-variation-settings'],
  ['mask', 'mask-border'],
  ['margin', 'margin-top'],
  ['margin', 'margin-right'],
  ['margin', 'margin-bottom'],
  ['margin', 'margin-left']
];

/**
 * Reorders declarations so that shorthands appear before any related longhands they would override, preventing cascade issues in the minified output.
 *
 * @param  {Array} declarations  The array of CSS declaration objects to reorder.
 * @return {Array}               A new array with declarations in the corrected order.
 */
function orderDeclarations (declarations) {
  const ordered = [...declarations];
  const findPropertyIndex = (property) => {
    return ordered.findIndex((declaration) => {
      return declaration?.property === property;
    });
  };

  for (const [property, followingProperty] of REQUIRED_PROPERTY_ORDER) {
    const fromIndex = findPropertyIndex(property);
    const toIndex = findPropertyIndex(followingProperty);
    if (fromIndex === -1 || toIndex === -1 || fromIndex < toIndex) {
      continue;
    }
    const [movedDeclaration] = ordered.splice(fromIndex, 1);
    ordered.splice(toIndex, 0, movedDeclaration);
  }

  return ordered;
}

/**
 * Get all longhands that a shorthand would override.
 *
 * @param  {string} shorthandProperty  The CSS shorthand property name.
 * @return {Array}                     A deduplicated array of all longhand property names that the shorthand overrides, including nested longhands.
 */
function getOverriddenLonghands (shorthandProperty) {
  const direct = shorthandMap[shorthandProperty] || [];
  const overrides = shorthandOverrideMap[shorthandProperty] || [];
  const all = [...direct, ...overrides];
  for (const property of direct) {
    const nested = shorthandMap[property] || [];
    all.push(...nested);
  }
  return [...new Set(all)];
}

export {
  getOverriddenLonghands,
  orderDeclarations
};

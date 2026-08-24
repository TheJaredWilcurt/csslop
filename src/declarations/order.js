/**
 * @file Orders declarations within a rule so that shorthands stay ahead of the longhands they reset.
 */

import {
  shorthandMap,
  shorthandOverrideMap
} from './config.js';
import { collectDeclaredProperties } from './lookup.js';

/**
 * Pairs of properties where the first must be emitted before the second, because
 * the first resets the second and a merged shorthand is appended after the
 * longhands it was built from.
 *
 * @type {Array}
 */
const REQUIRED_PROPERTY_ORDER = [
  ['animation', 'animation-timeline'],
  ['animation', 'animation-range'],
  ['animation', 'animation-range-start'],
  ['animation', 'animation-range-end'],
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
  // Most rules declare neither half of any of these pairs, so the properties a
  // rule does declare are gathered once rather than scanned for per pair.
  // Reordering the declarations never changes which properties are declared,
  // so the set stays accurate as the pairs are applied.
  const declaredProperties = collectDeclaredProperties(ordered);

  for (const [property, followingProperty] of REQUIRED_PROPERTY_ORDER) {
    if (!declaredProperties.has(property) || !declaredProperties.has(followingProperty)) {
      continue;
    }
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
 * The overridden longhands of each shorthand, computed on first use. The
 * shorthand tables never change, so the answer for a property name is the same
 * every time it is asked for.
 *
 * @type {Map<string, Set<string>>}
 */
const overriddenLonghandsByShorthand = new Map();

/**
 * Collects all longhands that a shorthand would override.
 *
 * @param  {string} shorthandProperty  The CSS shorthand property name.
 * @return {Set}                       The longhand property names the shorthand overrides, including nested longhands.
 */
function collectOverriddenLonghands (shorthandProperty) {
  const direct = shorthandMap[shorthandProperty] || [];
  const overrides = shorthandOverrideMap[shorthandProperty] || [];
  const all = new Set([...direct, ...overrides]);
  for (const property of direct) {
    const nested = shorthandMap[property] || [];
    for (const nestedProperty of nested) {
      all.add(nestedProperty);
    }
  }
  return all;
}

/**
 * Get all longhands that a shorthand would override.
 *
 * @param  {string} shorthandProperty  The CSS shorthand property name.
 * @return {Set}                       The longhand property names that the shorthand overrides, including nested longhands.
 */
function getOverriddenLonghands (shorthandProperty) {
  let overridden = overriddenLonghandsByShorthand.get(shorthandProperty);
  if (!overridden) {
    overridden = collectOverriddenLonghands(shorthandProperty);
    overriddenLonghandsByShorthand.set(shorthandProperty, overridden);
  }
  return overridden;
}

export {
  getOverriddenLonghands,
  orderDeclarations
};

/**
 * @file Decides whether a group of longhand declarations may collapse into a shorthand and produces the merged value when it is safe.
 */

import { minifyValue } from '../value/minify.js';

import {
  BORDER_EDGE_PROPERTIES,
  CSS_WIDE_KEYWORDS,
  EDGE_SHORTHANDS,
  getLonghandsOf,
  getOverridesOf
} from './config.js';
import { indexFirstDeclarationByProperty } from './lookup.js';
import { buildShorthandValue } from './shorthand-values.js';

/**
 * Shorthands that may still be built when only some of their longhands carry
 * `!important`, because the remaining longhands stay in the output.
 *
 * @type {Set<string>}
 */
const MIXED_IMPORTANT_SHORTHANDS = new Set(['margin', 'padding', 'inset', 'position-try']);

/**
 * The shorthands that may be built from only some of their longhands, and the
 * longhands each of them cannot do without. Every listed group has to be
 * satisfied by at least one of the properties it holds, so `font` needs both a
 * size and a family, while `background` needs a color or an image.
 *
 * @type {{[key: string]: Array}}
 */
const PARTIAL_MERGE_REQUIREMENTS = {
  animation: [['animation-name'], ['animation-duration']],
  background: [['background-color', 'background-image']],
  'background-position': [['background-position-x'], ['background-position-y']],
  'border-image': [['border-image-source']],
  columns: [['column-width', 'column-count', 'column-height']],
  font: [['font-size'], ['font-family']],
  mask: [['mask-image']]
};

/**
 * Checks whether a rule declares enough of a shorthand's longhands for the
 * shorthand to be built from the subset it does declare.
 *
 * @param  {Array}   requirementGroups   The groups of interchangeable longhands the shorthand requires.
 * @param  {Set}     declaredProperties  The property names the rule currently declares.
 * @return {boolean}                     Whether every requirement group is satisfied.
 */
function meetsPartialMergeRequirements (requirementGroups, declaredProperties) {
  return requirementGroups.every((requiredProperties) => {
    return requiredProperties.some((property) => {
      return declaredProperties.has(property);
    });
  });
}

/**
 * Determines which longhand properties are present and eligible for merging into a given shorthand. Returns null when the required longhands for the shorthand are not all available.
 *
 * @param  {string}     shorthand           The CSS shorthand property name.
 * @param  {Array}      longhands           The expected longhand property names for this shorthand.
 * @param  {Set}        declaredProperties  The property names the rule currently declares.
 * @return {Array|null}                     The list of longhand names to merge, or null if merging is not possible.
 */
function getMergeProps (shorthand, longhands, declaredProperties) {
  const presentLonghands = longhands.filter((longhand) => {
    return declaredProperties.has(longhand);
  });
  if (presentLonghands.length === 0) {
    return null;
  }
  const requirementGroups = PARTIAL_MERGE_REQUIREMENTS[shorthand];
  if (requirementGroups) {
    if (meetsPartialMergeRequirements(requirementGroups, declaredProperties)) {
      return presentLonghands;
    }
    return null;
  }
  if (shorthand === 'border') {
    const hasAllBorderParts = (
      declaredProperties.has('border-width') &&
      declaredProperties.has('border-style') &&
      declaredProperties.has('border-color')
    );
    if (hasAllBorderParts) {
      return ['border-width', 'border-style', 'border-color'];
    }
    const hasAllBorderEdges = BORDER_EDGE_PROPERTIES.every((edgeProperty) => {
      return declaredProperties.has(edgeProperty);
    });
    if (hasAllBorderEdges) {
      return [...BORDER_EDGE_PROPERTIES];
    }
    return null;
  }
  if (shorthand === 'flex') {
    const hasAllFlexParts = (
      declaredProperties.has('flex-grow') &&
      declaredProperties.has('flex-shrink') &&
      declaredProperties.has('flex-basis')
    );
    if (hasAllFlexParts) {
      return ['flex-grow', 'flex-shrink', 'flex-basis'];
    }
    return null;
  }
  if (presentLonghands.length === longhands.length) {
    return longhands;
  }
  return null;
}

/**
 * Check if a value contains var() - don't merge if it does (safest approach).
 *
 * @param  {string}  value  The minified CSS value string to check.
 * @return {boolean}        True if the value contains a var() with a fallback comma.
 */
function hasVarFallback (value) {
  // Match var() containing a comma (indicating a fallback value)
  return /var\([^)]*,/.test(value);
}

/**
 * Determines whether a value containing var() references can safely be merged into a shorthand. Values with fallback commas or unregistered custom properties are not mergeable.
 *
 * @param  {string}  value    The minified CSS value string to check.
 * @param  {object}  context  The minification context with registered custom property data.
 * @return {boolean}          True if the value is safe to merge into a shorthand.
 */
function canMergeVarValue (value, context) {
  // Check if the value contains any var() reference
  const containsVar = /var\(/.test(value);
  if (!containsVar || hasVarFallback(value)) {
    return !hasVarFallback(value);
  }
  // Extract all var() references with their custom property names
  const matches = [...value.matchAll(/var\((--[A-Za-z0-9_-]+)\)/g)];
  if (!matches.length) {
    return false;
  }
  return matches.every(([, propertyName]) => {
    return context.registeredCustomProperties.has(propertyName);
  });
}

/**
 * Checks whether a shorthand affects nothing beyond the longhands being merged.
 * When a shorthand also resets unrelated properties (for example `border` resets
 * `border-image`), replacing the longhands with a bare shorthand value would
 * change the rendered result.
 *
 * @param  {string}  shorthandName  The target shorthand property name.
 * @param  {Array}   properties     The longhand property names being merged.
 * @return {boolean}                True when the shorthand only affects the merged longhands.
 */
function shorthandAffectsOnlyMergedLonghands (shorthandName, properties) {
  if (getOverridesOf(shorthandName).size) {
    return false;
  }
  const mergedProperties = new Set(properties);
  return [...getLonghandsOf(shorthandName)].every((longhand) => {
    return mergedProperties.has(longhand);
  });
}

/**
 * Resolves how a set of longhand values that contain CSS-wide keywords such as
 * `inherit` may be merged. A CSS-wide keyword is only valid as a declaration's
 * entire value, so it can never appear as one component of a shorthand value:
 * `border-width:0;border-style:inherit;border-color:inherit` cannot become
 * `border:0 inherit inherit`. Only a set where every longhand carries the same
 * keyword can merge, and then only into a shorthand that affects nothing else.
 *
 * @param  {Array}       values         The cleaned longhand values, in longhand order.
 * @param  {string}      shorthandName  The target shorthand property name.
 * @param  {Array}       properties     The longhand property names being merged.
 * @return {string|null}                The shared keyword to use as the whole shorthand value, or null when merging is unsafe.
 */
function resolveCssWideKeywordMerge (values, shorthandName, properties) {
  const normalizedValues = values.map((value) => {
    return value.toLowerCase();
  });
  const sharedKeyword = normalizedValues[0];
  const isSharedByAll = normalizedValues.every((value) => {
    return value === sharedKeyword;
  });
  if (!isSharedByAll || !shorthandAffectsOnlyMergedLonghands(shorthandName, properties)) {
    return null;
  }
  return sharedKeyword;
}

/**
 * Collects the minified value of every longhand being merged, in shorthand
 * order. Returns null when any longhand is missing a declaration.
 *
 * @param  {Array}      properties    The longhand property names to merge.
 * @param  {Array}      declarations  The CSS declaration objects to draw values from.
 * @return {Array|null}               The minified longhand values, or null when one is missing.
 */
function collectLonghandValues (properties, declarations) {
  const declarationByProperty = indexFirstDeclarationByProperty(declarations);
  const values = properties.map((property) => {
    const declaration = declarationByProperty.get(property);
    if (declaration) {
      return minifyValue(declaration);
    }
    return null;
  });
  const hasNullValue = values.some((value) => {
    return value === null;
  });
  if (hasNullValue) {
    return null;
  }
  return values;
}

/**
 * Resolves the `!important` suffix for a merged shorthand. A shorthand only
 * keeps `!important` when every longhand carried it, and a mixed set is only
 * allowed for shorthands whose remaining important longhands stay in the output.
 *
 * @param  {Array}       values         The minified longhand values.
 * @param  {string}      shorthandName  The target shorthand property name.
 * @return {string|null}                The suffix to append, or null when the mix forbids merging.
 */
function resolveImportantSuffix (values, shorthandName) {
  const importantFlags = values.map((value) => {
    return value.includes('!important');
  });
  const allImportant = importantFlags.every((flag) => {
    return flag;
  });
  const noneImportant = importantFlags.every((flag) => {
    return !flag;
  });
  if (allImportant) {
    return '!important';
  }
  if (noneImportant || MIXED_IMPORTANT_SHORTHANDS.has(shorthandName)) {
    return '';
  }
  return null;
}

/**
 * Try to merge longhand properties into a shorthand.
 *
 * @param  {Array}       properties     The longhand property names to merge.
 * @param  {Array}       declarations   The CSS declaration objects to draw values from.
 * @param  {string}      shorthandName  The target shorthand property name.
 * @param  {object}      context        The minification context with registered custom property data.
 * @return {string|null}                The merged shorthand value string, or null if merging is not possible.
 */
function tryMergeToShorthand (properties, declarations, shorthandName = '', context) {
  if (properties.length < 2) {
    return null;
  }

  const values = collectLonghandValues(properties, declarations);
  if (!values) {
    return null;
  }

  // Don't merge if any value has var() with fallback or unknown custom properties
  const hasUnmergeableVar = values.some((value) => {
    return !canMergeVarValue(value, context);
  });
  if (hasUnmergeableVar) {
    return null;
  }

  const importantSuffix = resolveImportantSuffix(values, shorthandName);
  if (importantSuffix === null) {
    return null;
  }

  const cleanValues = values.map((value) => {
    return value
      .replace('!important', '')
      .trim();
  });
  const valueMap = new Map(properties.map((property, index) => {
    return [property, cleanValues[index]];
  }));

  const usesCssWideKeyword = cleanValues.some((value) => {
    return CSS_WIDE_KEYWORDS.has(value.toLowerCase());
  });
  if (usesCssWideKeyword) {
    const sharedKeyword = resolveCssWideKeywordMerge(cleanValues, shorthandName, properties);
    if (!sharedKeyword) {
      return null;
    }
    return sharedKeyword + importantSuffix;
  }

  // Each edge shorthand holds a complete width/style/color value, so the edges
  // only collapse into their parent shorthand when they are all identical.
  const mergesEdgeShorthands = properties.every((property) => {
    return EDGE_SHORTHANDS.has(property);
  });
  if (mergesEdgeShorthands) {
    const allEdgesMatch = cleanValues.every((value) => {
      return value === cleanValues[0];
    });
    if (!allEdgesMatch) {
      return null;
    }
    return cleanValues[0] + importantSuffix;
  }

  return buildShorthandValue(shorthandName, {
    properties,
    valueMap,
    cleanValues,
    importantSuffix
  });
}

export {
  canMergeVarValue,
  getMergeProps,
  tryMergeToShorthand
};

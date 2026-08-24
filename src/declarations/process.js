/**
 * @file Deduplicates, merges, and optimizes CSS declarations by collapsing longhand properties into shorthands and removing overridden values.
 */

import { minifyValue } from '../value/minify.js';
import { hasInvalidQuotesCount } from '../value/quotes.js';

import { absorbBackgroundLonghandsIntoShorthand } from './background.js';
import { collapseBorderTrioWithPerEdgeColor } from './border.js';
import {
  getLonghandsOf,
  shorthandMap
} from './config.js';
import { hoistCssWideKeywordsIntoShorthands } from './css-wide-keywords.js';
import { foldLonghandOverridesIntoShorthands } from './fold.js';
import {
  collectDeclaredProperties,
  indexFirstDeclarationByProperty
} from './lookup.js';
import {
  getMergeProps,
  tryMergeToShorthand
} from './merge.js';
import {
  getOverriddenLonghands,
  orderDeclarations
} from './order.js';

/**
 * Shorthands that keep their non-important longhands in the output, so a mixed
 * `!important` group still merges the important longhands into the shorthand.
 *
 * @type {Set<string>}
 */
const MIXED_IMPORTANT_SHORTHANDS = new Set(['margin', 'padding', 'inset']);

/**
 * Functions and syntaxes that older browsers do not understand, so an earlier
 * declaration using only classic syntax is kept as a fallback for them.
 *
 * @type {Array}
 */
const MODERN_SYNTAX_MARKERS = ['calc(', 'env(', 'var(', '-webkit-'];

/**
 * Determines whether a value relies on syntax that older browsers cannot parse,
 * which means a preceding declaration for the same property is an intentional
 * fallback rather than a redundant duplicate.
 *
 * @param  {string}  value  The minified CSS value string.
 * @return {boolean}        Whether the value uses modern syntax.
 */
function usesModernSyntax (value) {
  return MODERN_SYNTAX_MARKERS.some((marker) => {
    return value.includes(marker);
  });
}

/**
 * Creates the bookkeeping for the declarations that survive deduplication.
 *
 * A dropped declaration leaves an empty slot behind instead of being spliced
 * out, so that every position already recorded stays valid. Two indexes then
 * answer the questions the deduplication loop asks about the survivors: which
 * declaration last set a given property, and which vendor-prefixed
 * declarations are still standing.
 *
 * @return {object} The surviving-declaration bookkeeping.
 */
function createSurvivingDeclarations () {
  return {
    slots: [],
    positionsByProperty: new Map(),
    vendorPrefixedPositions: []
  };
}

/**
 * Records a declaration as surviving, at the end of the output so far.
 *
 * @param {object} survivors    The surviving-declaration bookkeeping.
 * @param {object} declaration  The declaration to keep.
 */
function keepDeclaration (survivors, declaration) {
  const position = survivors.slots.length;
  survivors.slots.push(declaration);
  if (!declaration.property) {
    return;
  }
  const positions = survivors.positionsByProperty.get(declaration.property);
  if (positions) {
    positions.push(position);
  } else {
    survivors.positionsByProperty.set(declaration.property, [position]);
  }
  if (declaration.property.startsWith('-')) {
    survivors.vendorPrefixedPositions.push(position);
  }
}

/**
 * Drops a declaration that a later one made redundant. Only the last surviving
 * declaration of a property is ever dropped, which is the one at the end of
 * that property's position list.
 *
 * @param {object} survivors  The surviving-declaration bookkeeping.
 * @param {number} position   The position of the declaration to drop.
 */
function dropDeclaration (survivors, position) {
  const { property } = survivors.slots[position];
  survivors.slots[position] = null;
  survivors.positionsByProperty.get(property).pop();
  const vendorPrefixedEntry = survivors.vendorPrefixedPositions.lastIndexOf(position);
  if (vendorPrefixedEntry !== -1) {
    survivors.vendorPrefixedPositions.splice(vendorPrefixedEntry, 1);
  }
}

/**
 * Finds the surviving declaration that last set a property, which is the one
 * that currently wins the cascade within the rule.
 *
 * @param  {object} survivors  The surviving-declaration bookkeeping.
 * @param  {string} property   The property name to look for.
 * @return {number}            The position of the matching declaration, or -1 when absent.
 */
function findLastPositionOfProperty (survivors, property) {
  const positions = survivors.positionsByProperty.get(property);
  if (!positions?.length) {
    return -1;
  }
  return positions[positions.length - 1];
}

/**
 * Finds the surviving vendor-prefixed declaration that last set the prefixed
 * form of a property, such as `-webkit-transform` for `transform`. Only the
 * prefixed declarations are visited, rather than every survivor.
 *
 * @param  {object} survivors  The surviving-declaration bookkeeping.
 * @param  {string} property   The unprefixed property name.
 * @return {number}            The position of the matching declaration, or -1 when absent.
 */
function findLastVendorPrefixedPosition (survivors, property) {
  for (let entry = survivors.vendorPrefixedPositions.length - 1; entry >= 0; entry--) {
    const position = survivors.vendorPrefixedPositions[entry];
    if (survivors.slots[position].property.endsWith(property)) {
      return position;
    }
  }
  return -1;
}

/**
 * Removes declarations that a later declaration for the same property makes
 * redundant, including vendor-prefixed duplicates, while keeping intentional
 * fallbacks for values that use modern syntax.
 *
 * @param  {Array} declarations  The declarations of a single rule, in source order.
 * @return {Array}               The surviving declarations, in source order.
 */
function deduplicateDeclarations (declarations) {
  const survivors = createSurvivingDeclarations();

  for (const declaration of declarations) {
    if (declaration.type === 'rule' || declaration.type === 'media') {
      keepDeclaration(survivors, declaration);
      continue;
    }

    const propertyName = declaration.property;
    if (!propertyName) {
      continue;
    }

    if (propertyName === 'quotes' && hasInvalidQuotesCount(declaration.value)) {
      continue;
    }

    const minifiedValue = minifyValue(declaration);

    const previousPosition = findLastPositionOfProperty(survivors, propertyName);

    // An unprefixed property with the same value also replaces its prefixed form
    let prefixedPosition = -1;
    if (!propertyName.startsWith('-')) {
      prefixedPosition = findLastVendorPrefixedPosition(survivors, propertyName);
    }

    if (prefixedPosition !== -1) {
      const prefixedValue = minifyValue(survivors.slots[prefixedPosition]);
      if (minifiedValue === prefixedValue) {
        dropDeclaration(survivors, prefixedPosition);
      }
    }

    if (previousPosition !== -1) {
      const previousValue = minifyValue(survivors.slots[previousPosition]);

      if (previousValue.includes('!important') && !minifiedValue.includes('!important')) {
        continue;
      }

      // Fallbacks for custom variables or older browser functions should be kept
      if (usesModernSyntax(minifiedValue) && !usesModernSyntax(previousValue)) {
        keepDeclaration(survivors, declaration);
        continue;
      }

      // Otherwise override previous identical property
      dropDeclaration(survivors, previousPosition);
    }

    keepDeclaration(survivors, declaration);
  }

  return survivors.slots.filter((slot) => {
    return slot !== null;
  });
}

/**
 * Indexes the position of the first declaration of each property, which is the
 * earliest position a property can occupy within the rule.
 *
 * @param  {Array} declarations  The declarations of a single rule, in source order.
 * @return {Map}                 Map of property name to its first index.
 */
function indexFirstDeclarationOfEachProperty (declarations) {
  const firstIndexByProperty = new Map();
  declarations.forEach((declaration, index) => {
    if (declaration.property && !firstIndexByProperty.has(declaration.property)) {
      firstIndexByProperty.set(declaration.property, index);
    }
  });
  return firstIndexByProperty;
}

/**
 * Removes longhand declarations that appear before a shorthand which resets
 * them, since the shorthand discards whatever the earlier longhand set.
 *
 * @param  {Array} declarations  The declarations of a single rule, in source order.
 * @return {Array}               The declarations without the overridden longhands.
 */
function removeLonghandsOverriddenByShorthands (declarations) {
  const propertiesToRemove = new Set();
  // A longhand precedes the shorthand exactly when its first occurrence does,
  // so one index of first positions answers every shorthand's question.
  const firstIndexByProperty = indexFirstDeclarationOfEachProperty(declarations);

  declarations.forEach((declaration, shorthandIndex) => {
    if (!declaration.property || !shorthandMap[declaration.property]) {
      return;
    }
    const overridden = getOverriddenLonghands(declaration.property);
    for (const longhandProperty of overridden) {
      const longhandIndex = firstIndexByProperty.get(longhandProperty);
      if (longhandIndex !== undefined && longhandIndex < shorthandIndex) {
        propertiesToRemove.add(longhandProperty);
      }
    }
  });

  return declarations.filter((declaration) => {
    return !propertiesToRemove.has(declaration.property);
  });
}

/**
 * Collects the longhand properties that a newly built shorthand replaces. For
 * shorthands that tolerate a mixed `!important` group, the important longhands
 * stay in the output so they keep winning over the shorthand.
 *
 * @param  {string} shorthandName         The shorthand that was built.
 * @param  {Array}  mergeableProperties   The longhand property names the shorthand covers.
 * @param  {Array}  relevantDeclarations  The declarations the shorthand was built from.
 * @return {Array}                        The longhand property names to drop.
 */
function getReplacedLonghands (shorthandName, mergeableProperties, relevantDeclarations) {
  const importantFlags = relevantDeclarations.map((declaration) => {
    return minifyValue(declaration).includes('!important');
  });
  const hasMixedImportant = (
    importantFlags.includes(true) &&
    importantFlags.includes(false)
  );
  if (!hasMixedImportant || !MIXED_IMPORTANT_SHORTHANDS.has(shorthandName)) {
    return mergeableProperties;
  }
  const declarationByProperty = indexFirstDeclarationByProperty(relevantDeclarations);
  return mergeableProperties.filter((property) => {
    const declaration = declarationByProperty.get(property);
    return declaration && !minifyValue(declaration).includes('!important');
  });
}

/**
 * Drops shorthands whose longhands are entirely consumed by a higher-level
 * shorthand built in the same pass. For example, `background-position` (x + y)
 * is redundant once `background` has consumed those same longhands.
 *
 * @param  {Array} builtDeclarations  The shorthand declarations built in one pass.
 * @return {Array}                    The shorthand declarations that are not subsumed.
 */
function removeSubsumedShorthands (builtDeclarations) {
  return builtDeclarations.filter((declaration) => {
    const longhands = shorthandMap[declaration.property];
    if (!longhands) {
      return true;
    }
    const isSubsumedByOtherShorthand = builtDeclarations.some((other) => {
      if (other === declaration || !shorthandMap[other.property]) {
        return false;
      }
      const otherLonghands = getLonghandsOf(other.property);
      return longhands.every((longhand) => {
        return otherLonghands.has(longhand);
      });
    });
    return !isSubsumedByOtherShorthand;
  });
}

/**
 * Builds every shorthand that the remaining longhands support, repeating until
 * no further shorthand can be created, so that shorthands built from other
 * shorthands (such as `border` from `border-width`) are also collapsed.
 *
 * @param  {Array}  declarations  The declarations of a single rule.
 * @param  {object} context       The minification context with registered custom property data.
 * @return {Array}                The declarations with longhands merged into shorthands.
 */
function mergeLonghandsIntoShorthands (declarations, context) {
  let result = declarations;
  let builtShorthand = true;

  while (builtShorthand) {
    builtShorthand = false;
    const replacedProperties = new Set();
    const builtDeclarations = [];
    // Every shorthand asks the same questions of the same declarations, so the
    // set of declared properties is gathered once per pass rather than rescanned
    // for each of the dozens of shorthand families.
    const declaredProperties = collectDeclaredProperties(result);

    for (const [shorthand, longhands] of Object.entries(shorthandMap)) {
      if (declaredProperties.has(shorthand)) {
        continue;
      }

      const mergeableProperties = getMergeProps(shorthand, longhands, declaredProperties);
      if (!mergeableProperties) {
        continue;
      }
      const mergeablePropertySet = new Set(mergeableProperties);
      const relevantDeclarations = result.filter((declaration) => {
        return mergeablePropertySet.has(declaration.property);
      });
      const mergedValue = tryMergeToShorthand(mergeableProperties, relevantDeclarations, shorthand, context);
      if (!mergedValue) {
        continue;
      }

      builtDeclarations.push({
        property: shorthand,
        value: mergedValue,
        isAssembledShorthand: true
      });
      const replacedLonghands = getReplacedLonghands(shorthand, mergeableProperties, relevantDeclarations);
      for (const property of replacedLonghands) {
        replacedProperties.add(property);
      }
    }

    if (builtDeclarations.length) {
      const keptDeclarations = result.filter((declaration) => {
        return !replacedProperties.has(declaration.property);
      });
      result = [...keptDeclarations, ...removeSubsumedShorthands(builtDeclarations)];
      builtShorthand = true;
    }
  }

  return result;
}

/**
 * Deduplicates, merges, and optimizes CSS declarations within a rule block. Removes overridden longhands, collapses longhands into shorthands, and preserves intentional fallbacks.
 *
 * @param  {Array}  declarations  The array of CSS declaration objects to process.
 * @param  {object} context       The minification context with registered custom property data.
 * @return {Array}                A new array of optimized and reordered declaration objects.
 */
function processDeclarations (declarations, context) {
  let result = deduplicateDeclarations(declarations);
  result = removeLonghandsOverriddenByShorthands(result);
  result = absorbBackgroundLonghandsIntoShorthand(result);
  result = mergeLonghandsIntoShorthands(result, context);
  result = foldLonghandOverridesIntoShorthands(result, context);
  result = hoistCssWideKeywordsIntoShorthands(result);
  result = collapseBorderTrioWithPerEdgeColor(result);

  return orderDeclarations(result);
}

export { processDeclarations };

/**
 * @file Deduplicates, merges, and optimizes CSS declarations by collapsing longhand properties into shorthands and removing overridden values.
 */

import { minifyValue } from '../value/minify.js';
import { hasInvalidQuotesCount } from '../value/quotes.js';

import { absorbBackgroundLonghandsIntoShorthand } from './background.js';
import { collapseBorderTrioWithPerEdgeColor } from './border.js';
import { shorthandMap } from './config.js';
import { hoistCssWideKeywordsIntoShorthands } from './css-wide-keywords.js';
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
 * Finds the index of the last declaration matching a predicate, which is the
 * declaration that wins the cascade within a rule.
 *
 * @param  {Array}                     declarations  The declarations to search.
 * @param  {function(object): boolean} predicate     Called with each declaration, returning whether it matches.
 * @return {number}                                  The index of the matching declaration, or -1 when absent.
 */
function findLastIndex (declarations, predicate) {
  for (let index = declarations.length - 1; index >= 0; index--) {
    if (predicate(declarations[index])) {
      return index;
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
  const result = [];

  for (const declaration of declarations) {
    if (declaration.type === 'rule' || declaration.type === 'media') {
      result.push(declaration);
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

    let previousIndex = findLastIndex(result, (candidate) => {
      return candidate.property === propertyName;
    });

    // An unprefixed property with the same value also replaces its prefixed form
    let prefixedIndex = -1;
    if (!propertyName.startsWith('-')) {
      prefixedIndex = findLastIndex(result, (candidate) => {
        return (
          candidate.property &&
          candidate.property.endsWith(propertyName) &&
          candidate.property.startsWith('-')
        );
      });
    }

    if (prefixedIndex !== -1) {
      const prefixedValue = minifyValue(result[prefixedIndex]);
      if (minifiedValue === prefixedValue) {
        result.splice(prefixedIndex, 1);
        // Re-adjust previousIndex if we removed an item before it
        if (previousIndex > prefixedIndex) {
          previousIndex--;
        }
      }
    }

    if (previousIndex !== -1) {
      const previousValue = minifyValue(result[previousIndex]);

      if (previousValue.includes('!important') && !minifiedValue.includes('!important')) {
        continue;
      }

      // Fallbacks for custom variables or older browser functions should be kept
      if (usesModernSyntax(minifiedValue) && !usesModernSyntax(previousValue)) {
        result.push(declaration);
        continue;
      }

      // Otherwise override previous identical property
      result.splice(previousIndex, 1);
    }

    result.push(declaration);
  }

  return result;
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

  declarations.forEach((declaration, shorthandIndex) => {
    if (!declaration.property || !shorthandMap[declaration.property]) {
      return;
    }
    const overridden = getOverriddenLonghands(declaration.property);
    for (const longhandProperty of overridden) {
      const longhandIndex = declarations.findIndex((candidate, index) => {
        return candidate.property === longhandProperty && index < shorthandIndex;
      });
      if (longhandIndex !== -1) {
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
  return mergeableProperties.filter((property) => {
    const declaration = relevantDeclarations.find((candidate) => {
      return candidate.property === property;
    });
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
      if (other === declaration) {
        return false;
      }
      const otherLonghands = shorthandMap[other.property];
      if (!otherLonghands) {
        return false;
      }
      return longhands.every((longhand) => {
        return otherLonghands.includes(longhand);
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

    for (const [shorthand, longhands] of Object.entries(shorthandMap)) {
      const shorthandAlreadyExists = result.some((declaration) => {
        return declaration.property === shorthand;
      });
      if (shorthandAlreadyExists) {
        continue;
      }

      const mergeableProperties = getMergeProps(shorthand, longhands, result);
      if (!mergeableProperties) {
        continue;
      }
      const relevantDeclarations = result.filter((declaration) => {
        return mergeableProperties.includes(declaration.property);
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
  result = hoistCssWideKeywordsIntoShorthands(result);
  result = collapseBorderTrioWithPerEdgeColor(result);

  return orderDeclarations(result);
}

export { processDeclarations };

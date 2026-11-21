/**
 * @file Folds a rule into the rule that follows it when the later rule restates everything the earlier one declares, so the two can share a selector list.
 */

import { minifyValue } from '../../value/minify.js';

import {
  collectWrittenLeafProperties,
  expandToOverridableProperties,
  propertySetsOverlap
} from './declaration-writes.js';
import {
  collectCandidateParentSelectors,
  createNestedSelectorMatcher
} from './nest-rules.js';
import { normalizeSelector } from './selector-normalization.js';
import { selectorsShareSpecificity } from './specificity.js';

/**
 * Returns a declaration's value in its minified spelling, so values that differ
 * only in how they are written, such as `rgb(255, 0, 0)` and `#F00`, compare as
 * equal.
 *
 * @param  {object} declaration  The AST declaration node.
 * @return {string}              The minified value, or an empty string when there is none.
 */
function getComparableValue (declaration) {
  return declaration.value ? minifyValue(declaration) : '';
}

/**
 * Removes duplicate selectors from a combined selector list by normalizing
 * whitespace and preserving the first occurrence of each unique selector.
 *
 * @param  {Array} selectors  The selector strings to deduplicate.
 * @return {Array}            A new array with duplicate selectors removed.
 */
function deduplicateSelectors (selectors) {
  const seen = new Set();
  return selectors.filter((selector) => {
    // Normalize whitespace to single spaces for consistent comparison
    const normalized = selector.trim().replace(/\s+/g, ' ');
    if (seen.has(normalized)) {
      return false;
    }
    seen.add(normalized);
    return true;
  });
}

/**
 * The rule body entries that style nothing themselves, and so have no say in
 * whether one rule's body is carried by another's.
 *
 * @type {Set<string>}
 */
const UNSTYLED_BODY_ENTRY_TYPES = new Set(['whitespace', 'comment']);

/**
 * Splits a rule body into the declarations it sets directly and the blocks
 * nested inside it, leaving out the entries that style nothing.
 *
 * @param  {Array}  declarations  The rule body entries.
 * @return {object}               The body's `plainDeclarations` and `nestedBlocks`.
 */
function partitionRuleBody (declarations) {
  const plainDeclarations = [];
  const nestedBlocks = [];
  for (const entry of declarations || []) {
    if (UNSTYLED_BODY_ENTRY_TYPES.has(entry.type)) {
      continue;
    }
    if (entry.property) {
      plainDeclarations.push(entry);
    } else {
      nestedBlocks.push(entry);
    }
  }
  return {
    nestedBlocks,
    plainDeclarations
  };
}

/**
 * Describes a block nested inside a rule precisely enough to tell whether two
 * rules nest the very same thing. Only plain nested rules can be described: an
 * at-rule nested in a rule carries a prelude that decides when its body applies,
 * so it is reported as indescribable rather than guessed at.
 *
 * @param  {object}      block  A block nested inside a rule body.
 * @return {string|null}        The signature, or null when the block cannot be described.
 */
function nestedBlockSignature (block) {
  if (block.type !== 'rule' || !block.selectors?.length) {
    return null;
  }
  const {
    nestedBlocks,
    plainDeclarations
  } = partitionRuleBody(block.declarations);
  const declarationParts = plainDeclarations.map((declaration) => {
    return declaration.property + ':' + getComparableValue(declaration);
  });
  const nestedParts = nestedBlocksSignature(nestedBlocks);
  if (nestedParts === null) {
    return null;
  }
  const selectors = block.selectors.map(normalizeSelector).join(',');
  return selectors + '{' + declarationParts.join(';') + nestedParts + '}';
}

/**
 * Describes every block nested in a rule body as one comparable string, in the
 * order the blocks are written, since that order decides which of them wins a
 * conflict.
 *
 * @param  {Array}       nestedBlocks  The blocks nested in a rule body.
 * @return {string|null}               The combined signature, or null when any block cannot be described.
 */
function nestedBlocksSignature (nestedBlocks) {
  let combined = '';
  for (const block of nestedBlocks) {
    const signature = nestedBlockSignature(block);
    if (signature === null) {
      return null;
    }
    combined += signature;
  }
  return combined;
}

/**
 * Combines an earlier rule with the rule that follows it when everything the
 * earlier one styles is restated by the later one, so the earlier selector can
 * simply join the later rule's shared part and the remainder stays behind in a
 * rule of its own.
 *
 * Both rules have to nest the same blocks. A block nested in only one of them
 * would either be lost or start matching the other rule's selector, neither of
 * which the two rules said.
 *
 * @param  {object}     previousRule  The rule immediately in front of `rule`.
 * @param  {object}     rule          The rule being folded into its predecessor.
 * @return {Array|null}               The rules that replace the pair, or null when they cannot be combined.
 */
function mergeRuleIntoPredecessor (previousRule, rule) {
  const isMergeableRulePair = (
    previousRule?.type === 'rule' &&
    previousRule.selectors?.length &&
    rule.type === 'rule' &&
    rule.selectors?.length
  );
  if (!isMergeableRulePair) {
    return null;
  }
  const previousBody = partitionRuleBody(previousRule.declarations);
  const currentBody = partitionRuleBody(rule.declarations);
  if (!previousBody.plainDeclarations.length || !currentBody.plainDeclarations.length) {
    return null;
  }
  const previousNesting = nestedBlocksSignature(previousBody.nestedBlocks);
  const currentNesting = nestedBlocksSignature(currentBody.nestedBlocks);
  if (previousNesting === null || previousNesting !== currentNesting) {
    return null;
  }
  const currentValueByProperty = new Map(
    currentBody.plainDeclarations.map((declaration) => {
      return [declaration.property, getComparableValue(declaration)];
    })
  );
  const previousIsRestated = previousBody.plainDeclarations.every((declaration) => {
    return currentValueByProperty.get(declaration.property) === getComparableValue(declaration);
  });
  // `all` rewrites every other property, so the later rule restating a value is
  // no promise that it applies the same way once `all` has run.
  const currentResetsEverything = currentValueByProperty.has('all');
  if (!previousIsRestated || currentResetsEverything) {
    return null;
  }
  const combinedSelectors = deduplicateSelectors([...previousRule.selectors, ...rule.selectors]);
  if (previousBody.nestedBlocks.length && !selectorsShareSpecificity(combinedSelectors)) {
    return null;
  }
  const restatedProperties = new Set(
    previousBody.plainDeclarations.map((declaration) => {
      return declaration.property;
    })
  );
  const remainingDeclarations = currentBody.plainDeclarations.filter((declaration) => {
    return !restatedProperties.has(declaration.property);
  });
  const merged = [{ ...previousRule, selectors: combinedSelectors }];
  if (remainingDeclarations.length) {
    merged.push({ ...rule, declarations: remainingDeclarations });
  }
  return merged;
}

/**
 * Finds properties that are present in all adjacent rules with matching values.
 *
 * @param  {Array} adjacentRules  The consecutive rule nodes to compare.
 * @return {Map}                  Map of property name to value for properties common to all rules.
 */
function findCommonProperties (adjacentRules) {
  if (adjacentRules.length < 2) {
    return new Map();
  }

  const firstRuleBody = partitionRuleBody(adjacentRules[0].declarations);
  const commonProperties = new Map(
    firstRuleBody.plainDeclarations.map((declaration) => {
      return [declaration.property, (declaration.value || '').trim()];
    })
  );

  for (let ruleIndex = 1; ruleIndex < adjacentRules.length; ruleIndex++) {
    const currentRuleBody = partitionRuleBody(adjacentRules[ruleIndex].declarations);
    const currentValueByProperty = new Map(
      currentRuleBody.plainDeclarations.map((declaration) => {
        return [declaration.property, (declaration.value || '').trim()];
      })
    );

    for (const [property, value] of commonProperties) {
      if (currentValueByProperty.get(property) !== value) {
        commonProperties.delete(property);
      }
    }
  }

  return commonProperties;
}

/**
 * Checks if a rule contains the `all` property, which resets all other properties.
 *
 * @param  {object}  rule  The rule node to check.
 * @return {boolean}       True if the rule contains the `all` property.
 */
function hasAllProperty (rule) {
  const ruleBody = partitionRuleBody(rule.declarations);
  return ruleBody.plainDeclarations.some((declaration) => {
    return declaration.property === 'all';
  });
}

/**
 * Checks if any rule in a list contains the `all` property.
 *
 * @param  {Array}   rules  The rule nodes to check.
 * @return {boolean}        True if any rule contains the `all` property.
 */
function anyRuleHasAllProperty (rules) {
  return rules.some(hasAllProperty);
}

/**
 * Checks if any rule has nested blocks.
 *
 * @param  {Array}   rules  The rule nodes to check.
 * @return {boolean}        True if any rule has nested blocks.
 */
function anyRuleHasNestedBlocks (rules) {
  return rules.some((rule) => {
    const ruleBody = partitionRuleBody(rule.declarations);
    return ruleBody.nestedBlocks.length > 0;
  });
}

/**
 * Divides a rule's plain declarations by whether every adjacent rule shares
 * them, so the shared ones can move into one merged rule.
 *
 * @param  {Array}  declarations  The rule's plain declarations.
 * @param  {Map}    commonProps   The properties common to all adjacent rules.
 * @return {object}               The `sharedDeclarations` and `remainingDeclarations`.
 */
function splitSharedDeclarations (declarations, commonProps) {
  const sharedDeclarations = declarations.filter((declaration) => {
    return commonProps.has(declaration.property);
  });
  const remainingDeclarations = declarations.filter((declaration) => {
    return !commonProps.has(declaration.property);
  });
  return {
    remainingDeclarations,
    sharedDeclarations
  };
}

/**
 * Reports whether a declaration that stays behind writes to a leaf property
 * that a shared declaration also writes to, such as `margin-top` beside a shared
 * `margin`. Moving the shared declaration past it would change which one wins.
 *
 * @param  {Array}   declarationSplits  The shared and remaining declarations of each adjacent rule.
 * @return {boolean}                    True when a remaining declaration overlaps a shared one.
 */
function remainingDeclarationOverlapsShared (declarationSplits) {
  const sharedLeafProperties = new Set();
  for (const split of declarationSplits) {
    for (const declaration of split.sharedDeclarations) {
      for (const leafProperty of expandToOverridableProperties(declaration.property)) {
        sharedLeafProperties.add(leafProperty);
      }
    }
  }
  return declarationSplits.some((split) => {
    return split.remainingDeclarations.some((declaration) => {
      return [...expandToOverridableProperties(declaration.property)].some((leafProperty) => {
        return sharedLeafProperties.has(leafProperty);
      });
    });
  });
}

/**
 * Reports whether a rule declares some property more than once, such as a
 * fallback value written before the one browsers support. Only one of those
 * values could be shared, so such rules are never combined.
 *
 * @param  {Array}   rules  The rule nodes to check.
 * @return {boolean}        True when any rule declares a property more than once.
 */
function anyRuleRepeatsProperty (rules) {
  return rules.some((rule) => {
    const ruleBody = partitionRuleBody(rule.declarations);
    const properties = ruleBody.plainDeclarations.map((declaration) => {
      return declaration.property;
    });
    return new Set(properties).size !== properties.length;
  });
}

/**
 * Reports whether every adjacent rule restates each property the first rule
 * declares. Only then can the first rule's whole body move into the merged
 * rule, since a rule missing one of those properties would pick it up.
 *
 * @param  {Array}   adjacentRules  The consecutive rule nodes to merge.
 * @return {boolean}                True when no rule is missing a property of the first rule.
 */
function everyRuleRestatesFirstRuleProperties (adjacentRules) {
  const propertiesByRule = adjacentRules.map((rule) => {
    const ruleBody = partitionRuleBody(rule.declarations);
    return new Set(ruleBody.plainDeclarations.map((declaration) => {
      return declaration.property;
    }));
  });
  const firstRuleProperties = [...propertiesByRule[0]];
  return propertiesByRule.every((properties) => {
    return firstRuleProperties.every((property) => {
      return properties.has(property);
    });
  });
}

/**
 * Combines the selectors of every rule in a run, without duplicates.
 *
 * @param  {Array} adjacentRules  The consecutive rule nodes in the run.
 * @return {Array}                The combined selectors.
 */
function combineSelectors (adjacentRules) {
  const combinedSelectors = [];
  for (const rule of adjacentRules) {
    combinedSelectors.push(...rule.selectors);
  }
  return deduplicateSelectors(combinedSelectors);
}

/**
 * Builds the merge for a run in which every rule restates the first rule's
 * properties. The first rule's body moves into one rule carrying every selector,
 * and each later rule keeps only the declarations that differ from the first's.
 *
 * @param  {Array}      adjacentRules  The consecutive rule nodes to merge.
 * @return {Array|null}                The rules replacing the run, or null when a restated declaration cannot move up.
 */
function buildFirstRuleMerge (adjacentRules) {
  const firstRuleBody = partitionRuleBody(adjacentRules[0].declarations);
  const mergedRule = {
    ...adjacentRules[0],
    selectors: combineSelectors(adjacentRules),
    declarations: firstRuleBody.plainDeclarations
  };

  const result = [mergedRule];

  const keptDeclarations = [];
  const restatedDeclarations = [];
  for (let ruleIndex = 1; ruleIndex < adjacentRules.length; ruleIndex++) {
    const rule = adjacentRules[ruleIndex];
    const ruleBody = partitionRuleBody(rule.declarations);
    const differingDeclarations = ruleBody.plainDeclarations.filter((declaration) => {
      const firstRuleValue = firstRuleBody.plainDeclarations.find((decl) => {
        return decl.property === declaration.property;
      });
      if (!firstRuleValue) {
        return true;
      }
      return (declaration.value || '').trim() !== (firstRuleValue.value || '').trim();
    });
    keptDeclarations.push(...differingDeclarations);
    restatedDeclarations.push(...ruleBody.plainDeclarations.filter((declaration) => {
      return !differingDeclarations.includes(declaration);
    }));

    if (differingDeclarations.length > 0) {
      result.push({
        ...rule,
        declarations: differingDeclarations
      });
    }
  }

  // A restated declaration is dropped here and takes effect from the merged
  // rule instead, so it would lose to any kept declaration it shares a property with.
  const keptProperties = collectWrittenLeafProperties(keptDeclarations);
  if (propertySetsOverlap(keptProperties, collectWrittenLeafProperties(restatedDeclarations))) {
    return null;
  }
  return result;
}

/**
 * Builds the merge for a run in which some rules lack a property the first rule
 * has. The shared declarations move into one rule carrying every selector, and
 * each rule keeps the declarations it does not share in a rule of its own.
 *
 * @param  {Array}      adjacentRules  The consecutive rule nodes to merge.
 * @param  {Map}        commonProps    The properties common to all rules.
 * @return {Array|null}                The rules replacing the run, or null when the shared declarations cannot move.
 */
function buildSharedDeclarationMerge (adjacentRules, commonProps) {
  const declarationSplits = adjacentRules.map((rule) => {
    const ruleBody = partitionRuleBody(rule.declarations);
    return splitSharedDeclarations(ruleBody.plainDeclarations, commonProps);
  });
  if (remainingDeclarationOverlapsShared(declarationSplits)) {
    return null;
  }

  const remainingRules = adjacentRules.map((rule, ruleIndex) => {
    return {
      ...rule,
      declarations: declarationSplits[ruleIndex].remainingDeclarations
    };
  }).filter((rule) => {
    return rule.declarations.length > 0;
  });
  const mergedRule = {
    ...adjacentRules[0],
    selectors: combineSelectors(adjacentRules),
    declarations: declarationSplits[0].sharedDeclarations
  };
  return [...remainingRules, mergedRule];
}

/**
 * Calculates the approximate character size of a run of rules.
 *
 * @param  {Array}  rules  The rule nodes.
 * @return {number}        The total character count of the rules.
 */
function calculateRunSize (rules) {
  return rules.reduce((sum, rule) => {
    return sum + calculateRuleSize(rule);
  }, 0);
}

/**
 * Combines adjacent rules that share common properties, as long as the result
 * is smaller than the rules it replaces.
 *
 * @param  {Array} adjacentRules  The consecutive rule nodes to merge.
 * @param  {Map}   commonProps    The properties common to all rules.
 * @return {Array}                The rules after merging common properties.
 */
function mergeCommonProperties (adjacentRules, commonProps) {
  if (commonProps.size === 0) {
    return adjacentRules;
  }

  // Skip merging if any rule has the `all` property
  if (anyRuleHasAllProperty(adjacentRules)) {
    return adjacentRules;
  }

  // Skip merging if any rule has nested blocks
  if (anyRuleHasNestedBlocks(adjacentRules)) {
    return adjacentRules;
  }

  if (anyRuleRepeatsProperty(adjacentRules)) {
    return adjacentRules;
  }

  const result = everyRuleRestatesFirstRuleProperties(adjacentRules) ?
    buildFirstRuleMerge(adjacentRules) :
    buildSharedDeclarationMerge(adjacentRules, commonProps);

  // Check if the merge actually reduces size
  if (!result || calculateRunSize(result) >= calculateRunSize(adjacentRules)) {
    return adjacentRules;
  }

  return result;
}

/**
 * Calculates the approximate character size of a rule's selectors.
 *
 * @param  {object} rule  The rule node.
 * @return {number}       The total character count of all selectors.
 */
function calculateSelectorSize (rule) {
  if (!rule.selectors) {
    return 0;
  }
  return rule.selectors.join(',').length;
}

/**
 * Calculates the approximate character size of a rule's declarations.
 *
 * @param  {object} rule  The rule node.
 * @return {number}       The total character count of all declarations.
 */
function calculateDeclarationSize (rule) {
  const ruleBody = partitionRuleBody(rule.declarations);
  let size = 0;
  for (const declaration of ruleBody.plainDeclarations) {
    size += declaration.property.length + 1 + (declaration.value || '').length;
  }
  return size;
}

/**
 * Calculates the approximate character size of a rule.
 *
 * @param  {object} rule  The rule node.
 * @return {number}       The total character count of the rule.
 */
function calculateRuleSize (rule) {
  return calculateSelectorSize(rule) + calculateDeclarationSize(rule);
}

/**
 * Combines a run of adjacent rules that share common properties, leaving a run
 * of fewer than two rules as it is.
 *
 * @param  {Array} adjacentRules  The consecutive rule nodes in the run.
 * @return {Array}                The rules after merging common properties.
 */
function mergeAdjacentRuleRun (adjacentRules) {
  if (adjacentRules.length < 2) {
    return adjacentRules;
  }
  const commonProps = findCommonProperties(adjacentRules);
  return mergeCommonProperties(adjacentRules, commonProps);
}

/**
 * Reports whether a rule's selectors share a parent that nesting could factor
 * out, such as `.a` for `.a .b,.a .d`, so the rule is worth keeping in place
 * next to the rules it nests with.
 *
 * @param  {object}  rule  The AST rule node.
 * @return {boolean}       True when every selector of the rule nests under one shared parent.
 */
function hasSharedNestingParent (rule) {
  if (!rule.selectors || rule.selectors.length < 2) {
    return false;
  }
  return [...collectCandidateParentSelectors(rule.selectors[0].trim())].some((candidateParent) => {
    const matchNestedSelector = createNestedSelectorMatcher(candidateParent);
    return rule.selectors.every((selector) => {
      return matchNestedSelector(selector.trim()) !== null;
    });
  });
}

/**
 * Folds a rule into the rule it restates, which may sit further back than the
 * rule immediately before it. The rule can only join an earlier rule when every
 * rule between them leaves the properties it writes alone, since its
 * declarations would otherwise reach its selectors from the earlier position.
 * Rules are only passed over when one of them has a shared nesting parent, so
 * the rules are kept in place unless moving them lets nesting remove repetition.
 *
 * @param  {Array}   result  The rules merged so far, which the rule is folded into when possible.
 * @param  {object}  rule    The rule to fold in.
 * @return {boolean}         True when the rule was folded into an earlier rule.
 */
function foldIntoRestatingRule (result, rule) {
  const previousRuleIndex = result.findLastIndex((entry) => {
    return entry.type !== 'comment';
  });
  const merged = mergeRuleIntoPredecessor(result[previousRuleIndex], rule);
  if (merged) {
    result.splice(previousRuleIndex, 1, ...merged);
    return true;
  }

  const ruleWrites = collectWrittenLeafProperties([rule]);
  const writesBetween = new Set();
  let passesNestableRule = false;
  for (let index = previousRuleIndex; index >= 0; index--) {
    const entry = result[index];
    if (entry.type === 'comment') {
      continue;
    }
    if (entry.type !== 'rule' || !entry.selectors?.length) {
      return false;
    }
    if (index !== previousRuleIndex && passesNestableRule) {
      const restated = mergeRuleIntoPredecessor(entry, rule);
      if (restated?.length === 1 && !propertySetsOverlap(ruleWrites, writesBetween)) {
        result.splice(index, 1, restated[0]);
        return true;
      }
    }
    collectWrittenLeafProperties([entry], writesBetween);
    passesNestableRule = passesNestableRule || hasSharedNestingParent(entry);
    if (propertySetsOverlap(ruleWrites, writesBetween)) {
      return false;
    }
  }
  return false;
}

/**
 * Combines common properties across a run of adjacent rules. When the whole run
 * shares nothing, each contiguous part of it is tried in turn, so two rules that
 * share a declaration still combine when a neighbor does not share it.
 *
 * @param  {Array} adjacentRules  The consecutive rule nodes in the run.
 * @return {Array}                The rules after combining common properties.
 */
function mergeAdjacentRuleRunBySubruns (adjacentRules) {
  const mergedRun = mergeAdjacentRuleRun(adjacentRules);
  if (mergedRun !== adjacentRules) {
    return mergedRun;
  }
  for (let start = 0; start < adjacentRules.length - 1; start++) {
    for (let end = adjacentRules.length; end - start > 1; end--) {
      const subRun = adjacentRules.slice(start, end);
      const mergedSubRun = mergeAdjacentRuleRun(subRun);
      if (mergedSubRun !== subRun) {
        return mergeAdjacentRuleRunBySubruns([
          ...adjacentRules.slice(0, start),
          ...mergedSubRun,
          ...adjacentRules.slice(end)
        ]);
      }
    }
  }
  return adjacentRules;
}

/**
 * Merges consecutive rules whose declarations are a subset of the following rule, combining their selectors and splitting out any extra declarations. Also combines common properties across adjacent rules.
 *
 * @param  {Array} rules  The AST rule nodes to merge.
 * @return {Array}        A new array of rules with declaration-compatible consecutive rules combined.
 */
function mergeByDeclarations (rules) {
  const result = [];
  for (const rule of rules) {
    if (!foldIntoRestatingRule(result, rule)) {
      result.push(rule);
    }
  }

  // Pass to combine common properties across adjacent rules
  const finalResult = [];
  let adjacentRules = [];
  let heldComments = [];

  for (const entry of result) {
    if (entry.type === 'rule' && entry.selectors?.length) {
      adjacentRules.push(entry);
    } else if (entry.type === 'comment' && adjacentRules.length) {
      heldComments.push(entry);
    } else {
      finalResult.push(...mergeAdjacentRuleRunBySubruns(adjacentRules), ...heldComments, entry);
      adjacentRules = [];
      heldComments = [];
    }
  }

  finalResult.push(...mergeAdjacentRuleRunBySubruns(adjacentRules), ...heldComments);
  return finalResult;
}

export {
  mergeByDeclarations
};

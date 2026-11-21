/**
 * @file Folds a rule into the rule that follows it when the later rule restates everything the earlier one declares, so the two can share a selector list.
 */

import { minifyValue } from '../../value/minify.js';

import {
  collectWrittenLeafProperties,
  expandToOverridableProperties,
  isPropertyDeclaration,
  propertySetsOverlap
} from './declaration-writes.js';
import {
  createIdSet,
  createInterner
} from './id-sets.js';
import {
  collectCandidateParentSelectors,
  createNestedSelectorMatcher
} from './nest-rules.js';
import { normalizeSelector } from './selector-normalization.js';
import { findFirstPositionAtLeast } from './sorted-indexes.js';
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
 * Trims a selector and collapses its whitespace, so selectors that differ only
 * in spacing compare as the same selector.
 *
 * @param  {string} selector  The selector string.
 * @return {string}           The selector with its whitespace normalized.
 */
function normalizeSelectorWhitespace (selector) {
  // Normalize whitespace to single spaces for consistent comparison
  return selector.trim().replace(/\s+/g, ' ');
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
    const normalized = normalizeSelectorWhitespace(selector);
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
 * Creates the index `foldIntoRestatingRule` uses to find, without walking back
 * through every earlier rule, the one earlier rule a rule could be folded into.
 * Entries must be recorded as they are added to the merged rules, and recorded
 * again when a merge replaces them.
 *
 * @return {object} The empty fold index.
 */
function createFoldIndex () {
  return {
    // The last entry that is neither a comment nor a rule with selectors
    lastBarrierIndex: -1,
    // The last rule that writes `all`
    lastAllWriterIndex: -1,
    // The last rule that writes any property
    lastWriterIndex: -1,
    // The last rule that writes each leaf property
    lastWriterIndexByProperty: new Map(),
    // The ascending indexes of the rules that have a shared nesting parent
    nestableIndexes: [],
    writtenPropertiesByEntry: new WeakMap()
  };
}

/**
 * Returns every leaf property an entry writes, including within its nested
 * blocks, computing it only once for each entry.
 *
 * @param  {object} foldIndex  The index from `createFoldIndex`.
 * @param  {object} entry      The AST entry.
 * @return {Set}               The leaf property names the entry writes.
 */
function getFoldEntryWrites (foldIndex, entry) {
  let writtenProperties = foldIndex.writtenPropertiesByEntry.get(entry);
  if (!writtenProperties) {
    writtenProperties = collectWrittenLeafProperties([entry]);
    foldIndex.writtenPropertiesByEntry.set(entry, writtenProperties);
  }
  return writtenProperties;
}

/**
 * Records whether the rule at an index has a shared nesting parent, replacing
 * what was recorded for the rule that held the index before.
 *
 * @param {object} foldIndex  The index from `createFoldIndex`.
 * @param {object} rule       The AST rule node now at the index.
 * @param {number} index      The rule's index within the merged rules.
 */
function recordNestableRule (foldIndex, rule, index) {
  const { nestableIndexes } = foldIndex;
  const position = findFirstPositionAtLeast(nestableIndexes, index);
  const wasNestable = nestableIndexes[position] === index;
  const isNestable = hasSharedNestingParent(rule);
  if (isNestable && !wasNestable) {
    nestableIndexes.splice(position, 0, index);
  } else if (!isNestable && wasNestable) {
    nestableIndexes.splice(position, 1);
  }
}

/**
 * Records an entry newly added to the merged rules. Comments are passed over
 * by a fold, anything that is not a rule with selectors stops one, and a rule
 * is noted for the properties it writes and for whether it nests.
 *
 * @param {object} foldIndex  The index from `createFoldIndex`.
 * @param {object} entry      The AST entry that was added.
 * @param {number} index      The entry's index within the merged rules.
 */
function recordFoldEntry (foldIndex, entry, index) {
  if (entry.type === 'comment') {
    return;
  }
  if (entry.type !== 'rule' || !entry.selectors?.length) {
    foldIndex.lastBarrierIndex = index;
    return;
  }
  const writtenProperties = getFoldEntryWrites(foldIndex, entry);
  if (writtenProperties.size) {
    foldIndex.lastWriterIndex = index;
  }
  if (writtenProperties.has('all')) {
    foldIndex.lastAllWriterIndex = index;
  }
  for (const property of writtenProperties) {
    foldIndex.lastWriterIndexByProperty.set(property, index);
  }
  recordNestableRule(foldIndex, entry, index);
}

/**
 * Finds the last entry a rule could not be moved back across, either because
 * it stops every fold, or because the two write a property in common, as
 * `propertySetsOverlap` decides.
 *
 * @param  {object} foldIndex   The index from `createFoldIndex`.
 * @param  {Set}    ruleWrites  The leaf properties the rule writes.
 * @return {number}             The index of that entry, or -1 when there is none.
 */
function findFoldStopIndex (foldIndex, ruleWrites) {
  let stopIndex = foldIndex.lastBarrierIndex;
  if (!ruleWrites.size) {
    return stopIndex;
  }
  if (ruleWrites.has('all')) {
    return Math.max(stopIndex, foldIndex.lastWriterIndex);
  }
  stopIndex = Math.max(stopIndex, foldIndex.lastAllWriterIndex);
  for (const property of ruleWrites) {
    stopIndex = Math.max(stopIndex, foldIndex.lastWriterIndexByProperty.get(property) ?? -1);
  }
  return stopIndex;
}

/**
 * Folds a rule into the rule it restates, which may sit further back than the
 * rule immediately before it. The rule can only join an earlier rule when every
 * rule between them leaves the properties it writes alone, since its
 * declarations would otherwise reach its selectors from the earlier position.
 * Rules are only passed over when one of them has a shared nesting parent, so
 * the rules are kept in place unless moving them lets nesting remove repetition.
 *
 * A rule that restates another writes every property that rule writes, so the
 * only earlier rule it can be folded into is the last one that writes any of
 * the same properties. Rather than walking back to it, the fold index finds it.
 *
 * @param  {Array}   result     The rules merged so far, which the rule is folded into when possible.
 * @param  {object}  rule       The rule to fold in.
 * @param  {object}  foldIndex  The index from `createFoldIndex`, kept up to date with `result`.
 * @return {boolean}            True when the rule was folded into an earlier rule.
 */
function foldIntoRestatingRule (result, rule, foldIndex) {
  const previousRuleIndex = result.findLastIndex((entry) => {
    return entry.type !== 'comment';
  });
  const merged = mergeRuleIntoPredecessor(result[previousRuleIndex], rule);
  if (merged) {
    result.splice(previousRuleIndex, 1, ...merged);
    recordNestableRule(foldIndex, merged[0], previousRuleIndex);
    if (merged[1]) {
      recordFoldEntry(foldIndex, merged[1], previousRuleIndex + 1);
    }
    return true;
  }

  const stopIndex = findFoldStopIndex(foldIndex, getFoldEntryWrites(foldIndex, rule));
  const passesNestableRule = foldIndex.nestableIndexes.at(-1) > stopIndex;
  if (stopIndex < 0 || stopIndex === previousRuleIndex || !passesNestableRule) {
    return false;
  }
  const restated = mergeRuleIntoPredecessor(result[stopIndex], rule);
  if (restated?.length !== 1) {
    return false;
  }
  result[stopIndex] = restated[0];
  recordNestableRule(foldIndex, restated[0], stopIndex);
  return true;
}

/**
 * The leaf property ids written by a plain body entry that does not declare a
 * property, which is none.
 *
 * @type {Array<number>}
 */
const NO_LEAF_IDS = [];

/**
 * Reports whether a rule keeps every run it belongs to from combining common
 * properties, because it uses `all`, nests blocks, or repeats a property.
 *
 * @param  {object}  rule  The AST rule node.
 * @return {boolean}       True when no run containing the rule can be combined.
 */
function preventsCommonPropertyMerge (rule) {
  return (
    hasAllProperty(rule) ||
    anyRuleHasNestedBlocks([rule]) ||
    anyRuleRepeatsProperty([rule])
  );
}

/**
 * Creates the ids and reusable sets that measuring the runs of one call of
 * `mergeAdjacentRuleRunBySubruns` shares. Properties, property and value
 * pairs, leaf properties, and selectors are each given small integer ids, so
 * the runs are compared with integer sets instead of strings.
 *
 * @return {object} The run measuring context.
 */
function createRunMeasureContext () {
  const internLeafProperty = createInterner();
  const internProperty = createInterner();
  const internSelector = createInterner();
  const pairIdsByProperty = new Map();
  const leafIdsByProperty = new Map();
  let pairCount = 0;
  return {
    allLeafId: internLeafProperty('all'),
    commonProperties: createIdSet(),
    firstPairs: createIdSet(),
    keptLeaves: createIdSet(),
    restatedLeaves: createIdSet(),
    ruleProperties: createIdSet(),
    rulePairs: createIdSet(),
    seenSelectors: createIdSet(),
    sharedLeaves: createIdSet(),
    internProperty,
    internSelector,
    /**
     * Returns the id of a property and trimmed value pair.
     *
     * @param  {string} property  The property name.
     * @param  {string} value     The trimmed value.
     * @return {number}           The pair's id.
     */
    internPair: function (property, value) {
      let pairIdByValue = pairIdsByProperty.get(property);
      if (!pairIdByValue) {
        pairIdByValue = new Map();
        pairIdsByProperty.set(property, pairIdByValue);
      }
      let pairId = pairIdByValue.get(value);
      if (pairId === undefined) {
        pairId = pairCount++;
        pairIdByValue.set(value, pairId);
      }
      return pairId;
    },
    /**
     * Returns the ids of the leaf properties `expandToOverridableProperties`
     * reports for a property.
     *
     * @param  {string}        property  The property name.
     * @return {Array<number>}           The leaf property ids.
     */
    getLeafIds: function (property) {
      let leafIds = leafIdsByProperty.get(property);
      if (!leafIds) {
        leafIds = [...expandToOverridableProperties(property)].map(internLeafProperty);
        leafIdsByProperty.set(property, leafIds);
      }
      return leafIds;
    }
  };
}

/**
 * Gathers the facts about a rule that decide which runs it can be combined in,
 * and how large each such merge would be. Each declaration is measured the way
 * `calculateDeclarationSize` does, identified by the trimmed value that
 * `findCommonProperties` compares, and described by the leaf properties that
 * `collectWrittenLeafProperties` and `expandToOverridableProperties` report.
 *
 * @param  {object} rule     The AST rule node.
 * @param  {object} context  The context from `createRunMeasureContext`.
 * @return {object}          The rule's merge facts.
 */
function gatherRuleMergeFacts (rule, context) {
  const ruleBody = partitionRuleBody(rule.declarations);
  let declarationSize = 0;
  const declarations = ruleBody.plainDeclarations.map((declaration) => {
    const size = declaration.property.length + 1 + (declaration.value || '').length;
    declarationSize += size;
    const overridableLeafIds = context.getLeafIds(declaration.property);
    return {
      overridableLeafIds,
      pairId: context.internPair(declaration.property, (declaration.value || '').trim()),
      propertyId: context.internProperty(declaration.property),
      size,
      writtenLeafIds: isPropertyDeclaration(declaration) ? overridableLeafIds : NO_LEAF_IDS
    };
  });
  return {
    declarations,
    declarationSize,
    preventsMerge: preventsCommonPropertyMerge(rule),
    selectorIds: rule.selectors.map((selector) => {
      return context.internSelector(normalizeSelectorWhitespace(selector));
    }),
    selectorLengths: rule.selectors.map((selector) => {
      return selector.length;
    }),
    selectorSize: calculateSelectorSize(rule)
  };
}

/**
 * Adds a rule's selectors to a growing run's combined selector list, as
 * `combineSelectors` would build it and `calculateSelectorSize` would measure it.
 *
 * @param  {object} seenSelectors  The ids of the selectors already in the list.
 * @param  {object} facts          The rule's merge facts.
 * @param  {number} size           The size of the combined selectors so far, or -1 when there are none.
 * @return {number}                The size of the combined selectors with the rule's added.
 */
function addCombinedSelectors (seenSelectors, facts, size) {
  let combinedSize = size;
  for (let index = 0; index < facts.selectorIds.length; index++) {
    if (seenSelectors.add(facts.selectorIds[index])) {
      combinedSize += facts.selectorLengths[index] + 1;
    }
  }
  return combinedSize;
}

/**
 * Narrows a run's common property and value pairs to those a further rule
 * shares, the same way `findCommonProperties` does. The kept pairs are packed
 * at the front of the arrays.
 *
 * @param  {object} common     The run's common `pairIds` and `propertyIds`, narrowed in place.
 * @param  {object} rulePairs  The ids of the further rule's pairs.
 * @return {number}            The number of common pairs left.
 */
function narrowCommonPairs (common, rulePairs) {
  let keptCount = 0;
  for (let index = 0; index < common.count; index++) {
    if (rulePairs.has(common.pairIds[index])) {
      common.pairIds[keptCount] = common.pairIds[index];
      common.propertyIds[keptCount] = common.propertyIds[index];
      keptCount++;
    }
  }
  common.count = keptCount;
  return keptCount;
}

/**
 * Starts measuring the merge `buildFirstRuleMerge` would build for a run.
 *
 * @param  {object} context  The context from `createRunMeasureContext`.
 * @return {object}          The empty measure.
 */
function createFirstRuleMergeMeasure (context) {
  context.keptLeaves.clear();
  context.restatedLeaves.clear();
  return {
    leftBehindSize: 0,
    overlaps: false
  };
}

/**
 * Adds a later rule of a run to the measure of the merge `buildFirstRuleMerge`
 * would build. The rule keeps the declarations that differ from the first
 * rule's, and the merge is refused once a kept declaration writes a property
 * that a restated one does, as `propertySetsOverlap` decides.
 *
 * @param {object} measure  The measure from `createFirstRuleMergeMeasure`, updated in place.
 * @param {object} context  The context from `createRunMeasureContext`.
 * @param {object} facts    The merge facts of the rule being added.
 */
function addToFirstRuleMerge (measure, context, facts) {
  const { allLeafId, firstPairs, keptLeaves, restatedLeaves } = context;
  let keptCount = 0;
  let keptSize = 0;
  for (const declaration of facts.declarations) {
    const isKept = !firstPairs.has(declaration.pairId);
    if (isKept) {
      keptCount++;
      keptSize += declaration.size;
    }
    const ownLeaves = isKept ? keptLeaves : restatedLeaves;
    const otherLeaves = isKept ? restatedLeaves : keptLeaves;
    for (const leafId of declaration.writtenLeafIds) {
      ownLeaves.add(leafId);
      if (otherLeaves.has(leafId)) {
        measure.overlaps = true;
      }
    }
  }
  if (keptCount) {
    measure.leftBehindSize += facts.selectorSize + keptSize;
  }
  // `all` overlaps any other write
  const writesAll = keptLeaves.has(allLeafId) || restatedLeaves.has(allLeafId);
  if (writesAll && keptLeaves.size && restatedLeaves.size) {
    measure.overlaps = true;
  }
}

/**
 * Adds a rule to the measure of the merge `buildSharedDeclarationMerge` would
 * build, while the run's common properties stay the same. The rule leaves
 * behind its declarations that are not common, and the merge is refused once
 * one of them writes a property a shared declaration does, as
 * `remainingDeclarationOverlapsShared` decides.
 *
 * @param {object} measure  The measure from `measureSharedMerge`, updated in place.
 * @param {object} context  The context from `createRunMeasureContext`.
 * @param {object} facts    The merge facts of the rule being added.
 */
function addToSharedMerge (measure, context, facts) {
  const { commonProperties, sharedLeaves } = context;
  let keptCount = 0;
  let keptSize = 0;
  for (const declaration of facts.declarations) {
    if (commonProperties.has(declaration.propertyId)) {
      continue;
    }
    keptCount++;
    keptSize += declaration.size;
    for (const leafId of declaration.overridableLeafIds) {
      if (sharedLeaves.has(leafId)) {
        measure.overlaps = true;
      }
    }
  }
  if (keptCount) {
    measure.leftBehindSize += facts.selectorSize + keptSize;
  }
}

/**
 * Measures the merge `buildSharedDeclarationMerge` would build for a whole
 * run, which is needed again whenever the run's common properties change.
 *
 * @param  {object} context   The context from `createRunMeasureContext`.
 * @param  {Array}  runFacts  The merge facts of the rules.
 * @param  {number} start     The index the run starts at.
 * @param  {number} end       The exclusive index the run ends at.
 * @param  {object} common    The run's common `pairIds` and `propertyIds`.
 * @return {object}           The measure: the `leftBehindSize`, the `sharedSize` of the first rule's shared declarations, and whether it `overlaps`.
 */
function measureSharedMerge (context, runFacts, start, end, common) {
  const { commonProperties, sharedLeaves } = context;
  commonProperties.clear();
  for (let index = 0; index < common.count; index++) {
    commonProperties.add(common.propertyIds[index]);
  }
  sharedLeaves.clear();
  let sharedSize = 0;
  for (const declaration of runFacts[start].declarations) {
    if (commonProperties.has(declaration.propertyId)) {
      sharedSize += declaration.size;
      for (const leafId of declaration.overridableLeafIds) {
        sharedLeaves.add(leafId);
      }
    }
  }
  const measure = {
    leftBehindSize: 0,
    overlaps: false,
    sharedSize
  };
  for (let index = start; index < end; index++) {
    addToSharedMerge(measure, context, runFacts[index]);
  }
  return measure;
}

/**
 * Records the property and value pairs, and the properties, a rule declares.
 *
 * @param {object} context  The context from `createRunMeasureContext`.
 * @param {object} facts    The rule's merge facts.
 */
function recordRuleDeclarations (context, facts) {
  const { ruleProperties, rulePairs } = context;
  rulePairs.clear();
  ruleProperties.clear();
  for (const declaration of facts.declarations) {
    rulePairs.add(declaration.pairId);
    ruleProperties.add(declaration.propertyId);
  }
}

/**
 * Walks forward from a start index, growing the run one rule at a time, and
 * measures the merge `mergeCommonProperties` would build for each run, so only
 * the runs that would merge are ever built. The walk stops at the first rule
 * that leaves the run with no common property or that prevents merging, since
 * `mergeAdjacentRuleRun` leaves any longer run unchanged.
 *
 * A run in which every rule restates the first rule's properties merges as
 * `buildFirstRuleMerge` does: the first rule's declarations move to the merged
 * rule, and each later rule keeps the declarations that differ from the first
 * rule's. Any other run merges as `buildSharedDeclarationMerge` does: only the
 * common declarations move, and each rule keeps the rest. Which declarations
 * are common can change as the run grows, so that merge is then measured
 * again for the whole run. Either merge only happens when nothing it moves
 * changes the cascade, and the result is smaller.
 *
 * @param  {Array}  runFacts  The merge facts of the consecutive rules.
 * @param  {number} start     The index the runs start at.
 * @param  {object} context   The context from `createRunMeasureContext`.
 * @return {object}           The exclusive `runEnd` of the longest combinable run, and the ascending `mergingEnds` of the runs that would merge.
 */
function findMergingRunEnds (runFacts, start, context) {
  const mergingEnds = [];
  const firstFacts = runFacts[start];
  if (firstFacts.preventsMerge) {
    return {
      mergingEnds,
      runEnd: start
    };
  }
  const { firstPairs, ruleProperties, rulePairs, seenSelectors } = context;
  const common = {
    count: firstFacts.declarations.length,
    pairIds: [],
    propertyIds: []
  };
  firstPairs.clear();
  for (const declaration of firstFacts.declarations) {
    firstPairs.add(declaration.pairId);
    common.pairIds.push(declaration.pairId);
    common.propertyIds.push(declaration.propertyId);
  }
  seenSelectors.clear();
  let combinedSelectorSize = addCombinedSelectors(seenSelectors, firstFacts, -1);
  const firstRuleMerge = createFirstRuleMergeMeasure(context);
  let sharedMerge = null;
  let originalSize = firstFacts.selectorSize + firstFacts.declarationSize;
  let restatesFirstRule = true;
  let end = start + 1;
  while (end < runFacts.length) {
    const facts = runFacts[end];
    if (facts.preventsMerge) {
      break;
    }
    recordRuleDeclarations(context, facts);
    const previousCommonCount = common.count;
    if (!narrowCommonPairs(common, rulePairs)) {
      break;
    }
    end++;
    originalSize += facts.selectorSize + facts.declarationSize;
    combinedSelectorSize = addCombinedSelectors(seenSelectors, facts, combinedSelectorSize);
    restatesFirstRule = restatesFirstRule && firstFacts.declarations.every((declaration) => {
      return ruleProperties.has(declaration.propertyId);
    });

    let merge;
    let mergedSize;
    if (restatesFirstRule) {
      addToFirstRuleMerge(firstRuleMerge, context, facts);
      merge = firstRuleMerge;
      mergedSize = combinedSelectorSize + firstFacts.declarationSize + firstRuleMerge.leftBehindSize;
    } else {
      if (!sharedMerge || common.count !== previousCommonCount) {
        sharedMerge = measureSharedMerge(context, runFacts, start, end, common);
      } else {
        addToSharedMerge(sharedMerge, context, facts);
      }
      merge = sharedMerge;
      mergedSize = combinedSelectorSize + sharedMerge.sharedSize + sharedMerge.leftBehindSize;
    }
    if (!merge.overlaps && mergedSize < originalSize) {
      mergingEnds.push(end);
    }
  }
  return {
    mergingEnds,
    runEnd: end
  };
}

/**
 * Merges the longest run from a start index that `findMergingRunEnds` found
 * would merge, the same way the run would be merged on its own.
 *
 * @param  {Array}       rules        The consecutive rule nodes.
 * @param  {number}      start        The index the runs start at.
 * @param  {Array}       mergingEnds  The ascending exclusive ends of the runs that would merge.
 * @return {object|null}              The `end` of the merged run and the `mergedRules` replacing it, or null when no run merged.
 */
function mergeLongestRun (rules, start, mergingEnds) {
  for (let position = mergingEnds.length - 1; position >= 0; position--) {
    const end = mergingEnds[position];
    const subRun = rules.slice(start, end);
    const mergedRules = mergeAdjacentRuleRun(subRun);
    if (mergedRules !== subRun) {
      return {
        end,
        mergedRules
      };
    }
  }
  return null;
}

/**
 * Forgets the failed starts whose runs reached a rule a merge changed, since
 * those runs must be tried again, while every other failed start is unchanged.
 *
 * @param  {Array}  failedRunEnds  The exclusive run end of each failed start, updated in place.
 * @param  {number} mergeStart     The index the merge started at.
 * @return {number}                The earliest start that must be tried again.
 */
function forgetChangedRuns (failedRunEnds, mergeStart) {
  failedRunEnds.length = Math.min(failedRunEnds.length, mergeStart);
  let earliestStart = mergeStart;
  for (let start = mergeStart - 1; start >= 0; start--) {
    if (failedRunEnds[start] >= mergeStart) {
      failedRunEnds[start] = undefined;
      earliestStart = start;
    }
  }
  return earliestStart;
}

/**
 * Combines common properties across a run of adjacent rules. When the whole run
 * shares nothing, each contiguous part of it is tried in turn, so two rules that
 * share a declaration still combine when a neighbor does not share it.
 *
 * Parts are tried from the earliest start, longest first, and the search begins
 * again after each merge. Parts that would not merge are measured instead of
 * being built, and after a merge only the starts whose parts reach the merged
 * rules are tried again, since every other part is unchanged and has already
 * failed. A merge of the whole run ends the search.
 *
 * @param  {Array} adjacentRules  The consecutive rule nodes in the run.
 * @return {Array}                The rules after combining common properties.
 */
function mergeAdjacentRuleRunBySubruns (adjacentRules) {
  if (adjacentRules.length < 2) {
    return adjacentRules;
  }
  const context = createRunMeasureContext();
  const getRuleMergeFacts = (rule) => {
    return gatherRuleMergeFacts(rule, context);
  };
  // The exclusive end of the longest combinable run at each start index that
  // has already failed to merge, kept until a merge changes a rule it reached
  const failedRunEnds = [];
  const rules = [...adjacentRules];
  const runFacts = rules.map(getRuleMergeFacts);
  let start = 0;
  while (start < rules.length - 1) {
    if (failedRunEnds[start] !== undefined) {
      start++;
      continue;
    }
    const { mergingEnds, runEnd } = findMergingRunEnds(runFacts, start, context);
    const merge = mergeLongestRun(rules, start, mergingEnds);
    if (!merge) {
      failedRunEnds[start] = runEnd;
      start++;
      continue;
    }
    if (start === 0 && merge.end === rules.length) {
      return merge.mergedRules;
    }
    rules.splice(start, merge.end - start, ...merge.mergedRules);
    runFacts.splice(start, merge.end - start, ...merge.mergedRules.map(getRuleMergeFacts));
    start = forgetChangedRuns(failedRunEnds, start);
  }
  return rules;
}

/**
 * Merges consecutive rules whose declarations are a subset of the following rule, combining their selectors and splitting out any extra declarations. Also combines common properties across adjacent rules.
 *
 * @param  {Array} rules  The AST rule nodes to merge.
 * @return {Array}        A new array of rules with declaration-compatible consecutive rules combined.
 */
function mergeByDeclarations (rules) {
  const result = [];
  const foldIndex = createFoldIndex();
  for (const rule of rules) {
    if (!foldIntoRestatingRule(result, rule, foldIndex)) {
      result.push(rule);
      recordFoldEntry(foldIndex, rule, result.length - 1);
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

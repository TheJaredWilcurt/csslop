/**
 * @file Optimizes CSS rule structures by merging selectors, deduplicating keyframes, nesting flat rules, and consolidating `@media` and `@layer` blocks.
 */

import { deduplicateDeclarations } from '../../declarations/process.js';

import {
  deduplicateKeyframes,
  mergeContainerRules,
  mergeLayerRules,
  mergeMediaRules,
  removeIEMediaRules,
  simplifyNestedMediaRules
} from './at-rules.js';
import { removeEmptyRules } from './empty-rules.js';
import { expandPureNestedRules } from './expand-nesting.js';
import {
  factorCommonParents,
  factorSelectorBranches
} from './factor-parents.js';
import { mergeByDeclarations } from './merge-declarations.js';
import { mergeIdenticalNestedRules } from './merge-nested-rules.js';
import { mergeSelectorRules } from './merge-selectors.js';
import {
  clearCandidateParentSelectorCache,
  nestFlatRules
} from './nest-rules.js';
import {
  removeFullyOverriddenSelectors,
  removeOverriddenMultiSelectorProperties
} from './prune-overridden.js';
import { clearNormalizedSelectorCache } from './selector-normalization.js';
import { clearSpecificityCache } from './specificity.js';

/**
 * Discards every memoized specificity, normalized selector, and set of
 * candidate parent selectors. The minifier calls this around each stylesheet,
 * so the caches do not outlive the pass that filled them.
 */
function clearSelectorCaches () {
  clearSpecificityCache();
  clearNormalizedSelectorCache();
  clearCandidateParentSelectorCache();
}

/**
 * Drops the declarations that a later declaration of the same property makes
 * redundant, so rules that only differ by such duplicates can still merge.
 *
 * @param  {Array} rules  The AST rule nodes to deduplicate.
 * @return {Array}        A new array of rules with their redundant declarations removed.
 */
function deduplicateRuleDeclarations (rules) {
  return rules.map((rule) => {
    if (rule.type !== 'rule' || !rule.declarations) {
      return rule;
    }
    return {
      ...rule,
      declarations: deduplicateDeclarations(rule.declarations)
    };
  });
}

/**
 * Applies the structural optimization pipeline to a stylesheet or grouping
 * block, so merging at-rules does not leave their children unoptimized.
 *
 * @param  {Array} rules  The sibling AST entries.
 * @return {Array}        The optimized sibling entries.
 */
function optimizeRuleList (rules) {
  let result = deduplicateRuleDeclarations(expandPureNestedRules(rules));
  result = removeIEMediaRules(result);
  result = simplifyNestedMediaRules(result);
  result = removeEmptyRules(result);
  result = mergeLayerRules(result, mergeSelectorRules);
  result = mergeMediaRules(result, mergeSelectorRules);
  result = mergeContainerRules(result, mergeSelectorRules);
  result = deduplicateKeyframes(result);
  for (const rule of result) {
    if (rule.rules) {
      rule.rules = optimizeRuleList(rule.rules);
    }
  }
  result = mergeSelectorRules(result);
  result = removeOverriddenMultiSelectorProperties(result);
  result = removeFullyOverriddenSelectors(result);
  result = removeEmptyRules(result);
  result = mergeByDeclarations(result);
  result = nestFlatRules(result);
  result = mergeSelectorRules(result);
  result = removeEmptyRules(result);
  result = mergeByDeclarations(result);
  result = mergeSelectorRules(result);
  result = factorCommonParents(result);
  result = mergeSelectorRules(result);
  result = mergeIdenticalNestedRules(result);
  result = nestFlatRules(result);
  result = expandPureNestedRules(result);
  result.forEach(factorSelectorBranches);
  return mergeIdenticalNestedRules(result);
}

export {
  clearSelectorCaches,
  optimizeRuleList
};

/**
 * @file Optimizes CSS rule structures by merging selectors, deduplicating keyframes, nesting flat rules, and consolidating `@media` and `@layer` blocks.
 */

import { deduplicateDeclarations } from '../../declarations/process.js';
import { stringifyRule } from '../stringify.js';

import {
  deduplicateKeyframes,
  foldRepeatedMediaRules,
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
 * @param  {Array}  rules    The sibling AST entries.
 * @param  {object} context  The minification context used to measure the output.
 * @return {Array}           The optimized sibling entries.
 */
function runOptimizationPasses (rules, context) {
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
      rule.rules = optimizeRuleList(rule.rules, context);
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

/**
 * Measures how many characters a list of rules stringifies to, so two optimized
 * versions of the same rules can be compared by size.
 *
 * @param  {Array}  rules    The AST rule nodes to measure.
 * @param  {object} context  The minification context used to stringify the rules.
 * @return {number}          The length of the stringified rules.
 */
function measureRuleList (rules, context) {
  return rules.reduce((totalLength, rule) => {
    return totalLength + stringifyRule(rule, context).length;
  }, 0);
}

/**
 * Optimizes a list of sibling entries. A `@media` block that repeats the rule
 * before it is either merged with its earlier twin, as the pipeline does by
 * default, or folded into that rule as a nested `@media`. Which form is shorter
 * depends on the size of the selector and the media query, so when folding
 * applies both forms are optimized and the shorter output is kept.
 *
 * @param  {Array}  rules    The AST rule nodes to optimize.
 * @param  {object} context  The minification context used to measure the output.
 * @return {Array}           The optimized rules.
 */
function optimizeRuleList (rules, context) {
  const foldedRules = foldRepeatedMediaRules(rules);
  if (foldedRules.length === rules.length) {
    return runOptimizationPasses(rules, context);
  }
  // The passes mutate the rules they receive, so the folded form gets its own copy before the merged form is optimized
  const foldedCopy = structuredClone(foldedRules);
  const mergedResult = runOptimizationPasses(rules, context);
  const foldedResult = runOptimizationPasses(foldedCopy, context);
  return measureRuleList(foldedResult, context) < measureRuleList(mergedResult, context) ? foldedResult : mergedResult;
}

export {
  clearSelectorCaches,
  optimizeRuleList
};

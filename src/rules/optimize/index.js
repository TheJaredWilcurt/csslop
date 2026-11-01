/**
 * @file Optimizes CSS rule structures by merging selectors, deduplicating keyframes, nesting flat rules, and consolidating `@media` and `@layer` blocks.
 */

import {
  deduplicateKeyframes,
  mergeLayerRules,
  mergeMediaRules
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
import { nestFlatRules } from './nest-rules.js';
import {
  removeFullyOverriddenSelectors,
  removeOverriddenMultiSelectorProperties
} from './prune-overridden.js';
import { clearNormalizedSelectorCache } from './selector-normalization.js';
import { clearSpecificityCache } from './specificity.js';

/**
 * Discards every memoized specificity and normalized selector. The minifier
 * calls this around each stylesheet, so the caches do not outlive the pass that
 * filled them.
 */
function clearSelectorCaches () {
  clearSpecificityCache();
  clearNormalizedSelectorCache();
}

/**
 * Applies the structural optimization pipeline to a stylesheet or grouping
 * block, so merging at-rules does not leave their children unoptimized.
 *
 * @param  {Array} rules  The sibling AST entries.
 * @return {Array}        The optimized sibling entries.
 */
function optimizeRuleList (rules) {
  let result = expandPureNestedRules(rules);
  result = mergeLayerRules(result, mergeSelectorRules);
  result = mergeMediaRules(result, mergeSelectorRules);
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
  result = removeEmptyRules(result);
  result = mergeByDeclarations(result);
  result = factorCommonParents(result);
  result = nestFlatRules(result);
  result.forEach(factorSelectorBranches);
  return mergeIdenticalNestedRules(result);
}

export {
  clearSelectorCaches,
  optimizeRuleList
};

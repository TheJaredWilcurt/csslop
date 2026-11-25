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
import {
  mergeByDeclarations,
  setPartialShorthandGuard,
  wasPartialShorthandMergeBlocked
} from './merge-declarations.js';
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
 * Memoizes the optimized form of each list of nested entries, such as the
 * rules of a `@media` block, for the current stylesheet. When folding applies,
 * the optimizer runs every pass over two forms of the same stylesheet, which
 * hold almost all of the same nested lists. The optimized form only depends
 * on the content of the list, which as plain data is told apart exactly by its
 * JSON form. Each optimized form is kept as a copy, since the passes go on to
 * rewrite the rules they are handed.
 *
 * @type {Map<string, Array>}
 */
const optimizedRuleListsByContent = new Map();

/**
 * Discards every memoized specificity, normalized selector, set of candidate
 * parent selectors, and optimized list of nested entries. The minifier calls
 * this around each stylesheet, so the caches do not outlive the pass that
 * filled them.
 */
function clearOptimizationCaches () {
  clearSpecificityCache();
  clearNormalizedSelectorCache();
  clearCandidateParentSelectorCache();
  optimizedRuleListsByContent.clear();
}

/**
 * Copies an AST entry, or any array or plain object within one, so that
 * passes can mutate the copy without touching the original. The AST is plain
 * data that never refers to the same object twice, which lets a direct walk
 * over its fields stand in for the far slower general purpose
 * `structuredClone`.
 *
 * @param  {object|Array|string|number|boolean|null} value  The AST value to copy.
 * @return {object|Array|string|number|boolean|null}        A deep copy of the value.
 */
function cloneSyntaxTree (value) {
  if (Array.isArray(value)) {
    const copy = new Array(value.length);
    for (let i = 0; i < value.length; i++) {
      copy[i] = cloneSyntaxTree(value[i]);
    }
    return copy;
  }
  if (value === null || typeof value !== 'object') {
    return value;
  }
  const copy = {};
  for (const key in value) {
    copy[key] = cloneSyntaxTree(value[key]);
  }
  return copy;
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
  result = foldRepeatedMediaRules(result);
  result = expandPureNestedRules(result);
  result.forEach(factorSelectorBranches);
  return mergeIdenticalNestedRules(result);
}

/**
 * Stringifies each rule of a list on its own, keeping the strings in rule
 * order.
 *
 * @param  {Array}  rules    The AST rule nodes to stringify.
 * @param  {object} context  The minification context used to stringify the rules.
 * @return {Array}           The minified CSS string of each rule.
 */
function stringifyRuleList (rules, context) {
  return rules.map((rule) => {
    return stringifyRule(rule, context);
  });
}

/**
 * Stringifies each rule of a list on its own, reusing the string of any rule
 * whose content matches a rule of a list already stringified. The two forms of
 * the same rules that the optimizer compares mostly hold identical rules, and
 * a rule's string depends on nothing but its content, which as plain data is
 * told apart exactly by its JSON form.
 *
 * @param  {Array}  rules         The AST rule nodes to stringify.
 * @param  {Array}  knownRules    The rules of the list already stringified.
 * @param  {Array}  knownStrings  The minified CSS string of each known rule.
 * @param  {object} context       The minification context used to stringify the rules.
 * @return {Array}                The minified CSS string of each rule.
 */
function stringifyRuleListReusing (rules, knownRules, knownStrings, context) {
  const stringsByContent = new Map();
  knownRules.forEach((rule, index) => {
    stringsByContent.set(JSON.stringify(rule), knownStrings[index]);
  });
  return rules.map((rule) => {
    return stringsByContent.get(JSON.stringify(rule)) ?? stringifyRule(rule, context);
  });
}

/**
 * Measures how many characters a list of stringified rules adds up to, so two
 * optimized versions of the same rules can be compared by size.
 *
 * @param  {Array}  ruleStrings  The minified CSS string of each rule.
 * @return {number}              The combined length of the strings.
 */
function measureRuleStrings (ruleStrings) {
  return ruleStrings.reduce((totalLength, ruleString) => {
    return totalLength + ruleString.length;
  }, 0);
}

/**
 * Optimizes a list of sibling entries. A `@media` block that repeats the rule
 * before it is either merged with its earlier twin, as the pipeline does by
 * default, or folded into that rule as a nested `@media`. Which form is shorter
 * depends on the size of the selector and the media query, so when folding
 * applies both forms are optimized and the shorter output is kept. Comparing
 * the two forms means stringifying them, so the strings of the form that was
 * kept are handed back as well, sparing a caller that only needs the output
 * from stringifying the rules a second time.
 *
 * @param  {Array}  rules    The AST rule nodes to optimize.
 * @param  {object} context  The minification context used to measure the output.
 * @return {object}          The optimized `rules`, and their `ruleStrings` when the rules were stringified to be measured, otherwise null.
 */
function optimizeAndMeasureRuleList (rules, context) {
  const foldedRules = foldRepeatedMediaRules(rules);
  if (foldedRules.length === rules.length) {
    return {
      rules: runOptimizationPasses(rules, context),
      ruleStrings: null
    };
  }
  // The passes mutate the rules they receive, so the folded form gets its own copy before the merged form is optimized
  const foldedCopy = cloneSyntaxTree(foldedRules);
  const mergedResult = runOptimizationPasses(rules, context);
  const foldedResult = runOptimizationPasses(foldedCopy, context);
  const foldedStrings = stringifyRuleList(foldedResult, context);
  const mergedStrings = stringifyRuleListReusing(mergedResult, foldedResult, foldedStrings, context);
  if (measureRuleStrings(foldedStrings) < measureRuleStrings(mergedStrings)) {
    return {
      rules: foldedResult,
      ruleStrings: foldedStrings
    };
  }
  return {
    rules: mergedResult,
    ruleStrings: mergedStrings
  };
}

/**
 * Optimizes a list of sibling entries, such as the rules inside a grouping
 * at-rule, which later passes may still rewrite. A list with the same content
 * as one already optimized during this stylesheet is handed a fresh copy of
 * that list's optimized form instead of being optimized again.
 *
 * @param  {Array}  rules    The AST rule nodes to optimize.
 * @param  {object} context  The minification context used to measure the output.
 * @return {Array}           The optimized rules.
 */
function optimizeRuleList (rules, context) {
  const contentKey = JSON.stringify(rules);
  const optimizedCopy = optimizedRuleListsByContent.get(contentKey);
  if (optimizedCopy) {
    return cloneSyntaxTree(optimizedCopy);
  }
  const optimized = optimizeAndMeasureRuleList(rules, context).rules;
  optimizedRuleListsByContent.set(contentKey, cloneSyntaxTree(optimized));
  return optimized;
}

/**
 * Optimizes the top-level rules with merges that split a partial shorthand
 * held back or allowed, and stringifies the result.
 *
 * @param  {Array}   rules          The top-level AST rule nodes, which are rewritten.
 * @param  {object}  context        The minification context.
 * @param  {boolean} guardEnforced  Whether merges that would split a partial shorthand are held back.
 * @return {Array}                  The minified CSS string of each optimized rule.
 */
function optimizeAndStringifyWithGuard (rules, context, guardEnforced) {
  setPartialShorthandGuard(guardEnforced);
  const optimized = optimizeAndMeasureRuleList(rules, context);
  return optimized.ruleStrings || stringifyRuleList(optimized.rules, context);
}

/**
 * Optimizes the top-level rules of a stylesheet and stringifies the result.
 * Nothing rewrites the rules once they are optimized, so the strings measured
 * while optimizing them are already the final output.
 *
 * A merge that would split a partial shorthand, such as moving
 * `background-repeat` out of a rule that is otherwise written as `background`,
 * is first held back. Whether such a merge pays off depends on the rules that
 * remain, so when one was held back the stylesheet is optimized again with it
 * allowed, and the shorter of the two outputs is kept.
 *
 * @param  {Array}  rules    The top-level AST rule nodes.
 * @param  {object} context  The minification context.
 * @return {Array}           The minified CSS string of each optimized rule.
 */
function optimizeAndStringifyRuleList (rules, context) {
  const unguardedRules = cloneSyntaxTree(rules);
  const guardedOutput = optimizeAndStringifyWithGuard(rules, context, true);
  if (!wasPartialShorthandMergeBlocked()) {
    return guardedOutput;
  }
  clearOptimizationCaches();
  const unguardedOutput = optimizeAndStringifyWithGuard(unguardedRules, context, false);
  return measureRuleStrings(unguardedOutput) < measureRuleStrings(guardedOutput) ? unguardedOutput : guardedOutput;
}

export {
  clearOptimizationCaches,
  optimizeAndStringifyRuleList
};

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
  countHeldBackPartialShorthandMerges,
  isPartialShorthandGuardEnforced,
  mergeByDeclarations,
  recordHeldBackPartialShorthandMerge,
  setPartialShorthandGuard,
  wasPartialShorthandMergeBlocked
} from './merge-declarations.js';
import { mergeIdenticalNestedRules } from './merge-nested-rules.js';
import {
  clearSelectorKeyCache,
  mergeSelectorRules
} from './merge-selectors.js';
import {
  clearCandidateParentSelectorCache,
  nestFlatRules
} from './nest-rules.js';
import {
  removeFullyOverriddenSelectors,
  removeOverriddenMultiSelectorProperties
} from './prune-overridden.js';
import { clearNormalizedSelectorCache } from './selector-normalization.js';
import { clearNestingParentCache } from './selector-prefix-index.js';
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
 * Each entry also remembers whether the partial shorthand guard was enforced
 * while it was optimized, and whether the guard held a merge back. A list
 * optimized under the guard without holding anything back would come out the
 * same with the guard lifted, so it is reused either way.
 *
 * @type {Map<string, {rules: Array, guardEnforced: boolean, heldBackMerges: boolean}>}
 */
const optimizedRuleListsByContent = new Map();

/**
 * Discards every memoized specificity, normalized selector, set of candidate
 * parent selectors, list of nesting parents, selector key, and optimized list
 * of nested entries. The minifier calls
 * this around each stylesheet, so the caches do not outlive the pass that
 * filled them.
 */
function clearOptimizationCaches () {
  clearSpecificityCache();
  clearNormalizedSelectorCache();
  clearCandidateParentSelectorCache();
  clearNestingParentCache();
  clearSelectorKeyCache();
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
 * Optimizes the list of nested entries held by each grouping block, such as a
 * `@media` block, in place.
 *
 * @param  {Array}         rules          The sibling AST entries, whose nested lists are replaced.
 * @param  {object}        context        The minification context used to measure the output.
 * @param  {Array<string>} [contentKeys]  The JSON form of each entry's nested list, when already known.
 * @return {Array}                        The same sibling entries.
 */
function optimizeNestedRuleLists (rules, context, contentKeys) {
  rules.forEach((rule, index) => {
    if (rule.rules) {
      rule.rules = optimizeRuleList(rule.rules, context, contentKeys?.[index]);
    }
  });
  return rules;
}

/**
 * Rebuilds the entries a call of `optimizeNestedRuleLists` was handed, as
 * fresh copies. That pass only ever replaces the nested lists, whose original
 * content survives in their JSON form, so every other part of each entry is
 * still as it was handed in.
 *
 * @param  {Array}         rules        The sibling AST entries after their nested lists were optimized.
 * @param  {Array<string>} contentKeys  The JSON form of each entry's original nested list, or null for entries without one.
 * @return {Array}                      Copies of the entries as they were before their nested lists were optimized.
 */
function restoreNestedRuleListInputs (rules, contentKeys) {
  return rules.map((rule, index) => {
    const copy = cloneSyntaxTree(rule);
    if (contentKeys[index] !== null) {
      copy.rules = JSON.parse(contentKeys[index]);
    }
    return copy;
  });
}

/**
 * Runs a pass that leaves the rules it is handed untouched, and keeps a copy
 * of those rules when the pass held back a merge to keep a partial shorthand
 * whole, since the pass would then run differently with the guard lifted.
 *
 * @param  {function(Array): Array} pass   The pass to run.
 * @param  {Array}                  rules  The sibling AST entries to optimize.
 * @return {object}                        The `result` of the pass, and the `resumeRules` to run it again from, or null when nothing was held back.
 */
function runPurePassWithCheckpoint (pass, rules) {
  const heldBackBefore = countHeldBackPartialShorthandMerges();
  const result = pass(rules);
  const heldBack = countHeldBackPartialShorthandMerges() !== heldBackBefore;
  return {
    result,
    resumeRules: heldBack ? cloneSyntaxTree(rules) : null
  };
}

/**
 * Optimizes the nested lists of the grouping blocks among sibling entries, and
 * keeps a copy of the entries as they were handed in when doing so held back a
 * merge to keep a partial shorthand whole.
 *
 * @param  {Array}  rules    The sibling AST entries, whose nested lists are replaced.
 * @param  {object} context  The minification context used to measure the output.
 * @return {object}          The `result` of the pass, and the `resumeRules` to run it again from, or null when nothing was held back.
 */
function optimizeNestedRuleListsWithCheckpoint (rules, context) {
  const contentKeys = rules.map((rule) => {
    return rule.rules ? JSON.stringify(rule.rules) : null;
  });
  const heldBackBefore = countHeldBackPartialShorthandMerges();
  const result = optimizeNestedRuleLists(rules, context, contentKeys);
  const heldBack = countHeldBackPartialShorthandMerges() !== heldBackBefore;
  return {
    result,
    resumeRules: heldBack ? restoreNestedRuleListInputs(rules, contentKeys) : null
  };
}

/**
 * Runs `mergeByDeclarations`, keeping a copy of the rules it was handed when
 * it held back a merge to keep a partial shorthand whole. The pass never
 * changes the rules it is handed, so they can be copied after it ran.
 *
 * @param  {Array}  rules  The sibling AST entries to merge.
 * @return {object}        The `result` of the pass, and the `resumeRules` to run it again from, or null when nothing was held back.
 */
function mergeByDeclarationsWithCheckpoint (rules) {
  return runPurePassWithCheckpoint(mergeByDeclarations, rules);
}

/**
 * The structural optimization pipeline, in the order the passes run. Only the
 * passes that may hold back a merge to keep a partial shorthand whole have a
 * `runWithCheckpoint`, which runs the pass and reports the rules it could run
 * again from once the guard is lifted. Every pass before the first that held a
 * merge back runs the same with or without the guard, so the optimizer only
 * reruns the pipeline from there.
 *
 * @type {Array<{run: function(Array, object): Array, runWithCheckpoint: (function(Array, object): object|undefined)}>}
 */
const OPTIMIZATION_PASSES = [
  {
    run: function (rules) {
      return deduplicateRuleDeclarations(expandPureNestedRules(rules));
    }
  },
  {
    run: function (rules) {
      return removeIEMediaRules(rules);
    }
  },
  {
    run: function (rules) {
      return simplifyNestedMediaRules(rules);
    }
  },
  {
    run: function (rules) {
      return removeEmptyRules(rules);
    }
  },
  {
    run: function (rules) {
      return mergeLayerRules(rules, mergeSelectorRules);
    }
  },
  {
    run: function (rules) {
      return mergeMediaRules(rules, mergeSelectorRules);
    }
  },
  {
    run: function (rules) {
      return mergeContainerRules(rules, mergeSelectorRules);
    }
  },
  {
    run: function (rules) {
      return deduplicateKeyframes(rules);
    }
  },
  {
    run: function (rules, context) {
      return optimizeNestedRuleLists(rules, context);
    },
    runWithCheckpoint: optimizeNestedRuleListsWithCheckpoint
  },
  {
    run: function (rules) {
      return mergeSelectorRules(rules);
    }
  },
  {
    run: function (rules) {
      return removeOverriddenMultiSelectorProperties(rules);
    }
  },
  {
    run: function (rules) {
      return removeFullyOverriddenSelectors(rules);
    }
  },
  {
    run: function (rules) {
      return removeEmptyRules(rules);
    }
  },
  {
    run: function (rules) {
      return mergeByDeclarations(rules);
    },
    runWithCheckpoint: mergeByDeclarationsWithCheckpoint
  },
  {
    run: function (rules) {
      return nestFlatRules(rules);
    }
  },
  {
    run: function (rules) {
      return mergeSelectorRules(rules);
    }
  },
  {
    run: function (rules) {
      return removeEmptyRules(rules);
    }
  },
  {
    run: function (rules) {
      return mergeByDeclarations(rules);
    },
    runWithCheckpoint: mergeByDeclarationsWithCheckpoint
  },
  {
    run: function (rules) {
      return mergeSelectorRules(rules);
    }
  },
  {
    run: function (rules) {
      return factorCommonParents(rules);
    }
  },
  {
    run: function (rules) {
      return mergeSelectorRules(rules);
    }
  },
  {
    run: function (rules) {
      return mergeIdenticalNestedRules(rules);
    }
  },
  {
    run: function (rules) {
      return nestFlatRules(rules);
    }
  },
  {
    run: function (rules) {
      return foldRepeatedMediaRules(rules);
    }
  },
  {
    run: function (rules) {
      return expandPureNestedRules(rules);
    }
  },
  {
    run: function (rules) {
      rules.forEach(factorSelectorBranches);
      return mergeIdenticalNestedRules(rules);
    }
  }
];

/**
 * Applies the structural optimization pipeline to a stylesheet or grouping
 * block, starting from any pass, so merging at-rules does not leave their
 * children unoptimized.
 *
 * When a form is handed in, the first pass that holds back a merge to keep a
 * partial shorthand whole is recorded on it as its `resumePoint`: the index of
 * that pass and a copy of the rules it was handed, from which the pipeline can
 * run again once the guard is lifted.
 *
 * @param  {number}      firstPassIndex  The index of the first pass to run.
 * @param  {Array}       rules           The sibling AST entries.
 * @param  {object}      context         The minification context used to measure the output.
 * @param  {object|null} form            The form whose `resumePoint` is recorded, or null to record nothing.
 * @return {Array}                       The optimized sibling entries.
 */
function runOptimizationPassesFrom (firstPassIndex, rules, context, form) {
  let result = rules;
  for (let passIndex = firstPassIndex; passIndex < OPTIMIZATION_PASSES.length; passIndex++) {
    const pass = OPTIMIZATION_PASSES[passIndex];
    if (!form || form.resumePoint || !pass.runWithCheckpoint) {
      result = pass.run(result, context);
      continue;
    }
    const { resumeRules, result: passResult } = pass.runWithCheckpoint(result, context);
    if (resumeRules) {
      form.resumePoint = {
        passIndex,
        rules: resumeRules
      };
    }
    result = passResult;
  }
  return result;
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
 * a rule's string depends on nothing but its content.
 *
 * @param  {Array}  rules         The AST rule nodes to stringify.
 * @param  {Array}  knownRules    The rules of the list already stringified.
 * @param  {Array}  knownStrings  The minified CSS string of each known rule.
 * @param  {object} context       The minification context used to stringify the rules.
 * @return {Array}                The minified CSS string of each rule.
 */
function stringifyRuleListReusing (rules, knownRules, knownStrings, context) {
  const knownRuleStrings = addKnownRuleStrings(new Map(), knownRules, knownStrings);
  return stringifyRuleListFromKnown(rules, knownRuleStrings, context);
}

/**
 * Describes the outline of a rule cheaply: its type, the first selector or
 * the at-rule's prelude, how many entries it holds, and the value of its last
 * entry. Rules with the same content always share an outline, so only rules
 * sharing one need comparing.
 *
 * @param  {object} rule  The AST rule node.
 * @return {string}       The rule's outline.
 */
function describeRuleOutline (rule) {
  const label = rule.selectors?.[0] ?? rule.media ?? rule.name ?? '';
  const entries = rule.declarations || rule.rules || [];
  const lastValue = entries[entries.length - 1]?.value ?? '';
  return rule.type + '\n' + label + '\n' + entries.length + '\n' + lastValue;
}

/**
 * Reports whether two AST values hold the same content: the same primitives,
 * the same array items in order, and the same object keys with the same
 * values. The comparison stops at the first difference, which
 * makes it far cheaper than comparing the two values' JSON forms.
 *
 * @param  {object|Array|string|number|boolean|null} first   The first AST value.
 * @param  {object|Array|string|number|boolean|null} second  The second AST value.
 * @return {boolean}                                         True when the values hold the same content.
 */
function isSameSyntaxTree (first, second) {
  if (first === second) {
    return true;
  }
  if (!first || !second || typeof first !== 'object' || typeof second !== 'object') {
    return false;
  }
  const firstIsArray = Array.isArray(first);
  if (firstIsArray !== Array.isArray(second)) {
    return false;
  }
  if (firstIsArray) {
    return isSameArrayContent(first, second);
  }
  return isSameObjectContent(first, second);
}

/**
 * Reports whether two AST objects hold the same keys with the same values.
 * The keys are walked in place rather than listed, sparing an allocation for
 * every object compared.
 *
 * @param  {object}  first   The first AST object.
 * @param  {object}  second  The second AST object.
 * @return {boolean}         True when every key holds the same content in both.
 */
function isSameObjectContent (first, second) {
  for (const key in first) {
    const value = first[key];
    if (value === undefined && !(key in second)) {
      return false;
    }
    if (!isSameSyntaxTree(value, second[key])) {
      return false;
    }
  }
  for (const key in second) {
    if (!(key in first)) {
      return false;
    }
  }
  return true;
}

/**
 * Reports whether two AST arrays hold the same items in the same order.
 *
 * @param  {Array}   first   The first AST array.
 * @param  {Array}   second  The second AST array.
 * @return {boolean}         True when every item holds the same content.
 */
function isSameArrayContent (first, second) {
  if (first.length !== second.length) {
    return false;
  }
  for (let i = 0; i < first.length; i++) {
    if (!isSameSyntaxTree(first[i], second[i])) {
      return false;
    }
  }
  return true;
}

/**
 * Adds the minified CSS string of each rule of a list already stringified to
 * a lookup of known rule strings, grouped by each rule's outline.
 *
 * @param  {Map}   knownRuleStrings  The lookup to add to, in place.
 * @param  {Array} knownRules        The rules of the list already stringified.
 * @param  {Array} knownStrings      The minified CSS string of each known rule.
 * @return {Map}                     The same lookup.
 */
function addKnownRuleStrings (knownRuleStrings, knownRules, knownStrings) {
  knownRules.forEach((rule, index) => {
    addKnownRuleString(knownRuleStrings, rule, knownStrings[index]);
  });
  return knownRuleStrings;
}

/**
 * Adds one rule and its minified CSS string to a lookup of known rule
 * strings. The rule must not be changed while the lookup is in use.
 *
 * @param {Map}    knownRuleStrings  The lookup to add to, in place.
 * @param {object} rule              The AST rule node already stringified.
 * @param {string} ruleString        The rule's minified CSS string.
 */
function addKnownRuleString (knownRuleStrings, rule, ruleString) {
  const outline = describeRuleOutline(rule);
  const knownEntries = knownRuleStrings.get(outline);
  const entry = {
    rule,
    ruleString
  };
  if (knownEntries) {
    knownEntries.push(entry);
  } else {
    knownRuleStrings.set(outline, [entry]);
  }
}

/**
 * Finds the minified CSS string of a known rule with the same content.
 *
 * @param  {Map}              knownRuleStrings  The lookup of known rule strings.
 * @param  {object}           rule              The AST rule node to look up.
 * @return {string|undefined}                   The known string, or undefined when no known rule has the same content.
 */
function findKnownRuleString (knownRuleStrings, rule) {
  const knownEntries = knownRuleStrings.get(describeRuleOutline(rule));
  return knownEntries?.find((entry) => {
    return isSameSyntaxTree(entry.rule, rule);
  })?.ruleString;
}

/**
 * Stringifies each rule of a list on its own, reusing the string of any rule
 * whose content matches a known rule, and adding the strings of the rest.
 *
 * @param  {Array}  rules             The AST rule nodes to stringify.
 * @param  {Map}    knownRuleStrings  The lookup of known rule strings, added to in place.
 * @param  {object} context           The minification context used to stringify the rules.
 * @return {Array}                    The minified CSS string of each rule.
 */
function stringifyRuleListFromKnown (rules, knownRuleStrings, context) {
  return rules.map((rule) => {
    let ruleString = findKnownRuleString(knownRuleStrings, rule);
    if (ruleString === undefined) {
      ruleString = stringifyRule(rule, context);
      addKnownRuleString(knownRuleStrings, rule, ruleString);
    }
    return ruleString;
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
 * Creates one form of a list of sibling entries for the optimizer to try.
 *
 * @param  {Array}  input  The AST rule nodes the form starts from.
 * @return {object}        The form, holding its `input`, and the `rules`, `ruleStrings`, and `resumePoint` filled in as it is optimized.
 */
function createRuleListForm (input) {
  return {
    input,
    resumePoint: null,
    rules: null,
    ruleStrings: null
  };
}

/**
 * Lays out the forms of a list of sibling entries the optimizer tries. A
 * `@media` block that repeats the rule before it is either merged with its
 * earlier twin, as the pipeline does by default, or folded into that rule as a
 * nested `@media`. Which form is shorter depends on the size of the selector
 * and the media query, so when folding applies both forms are tried.
 *
 * @param  {Array}         rules  The AST rule nodes to optimize.
 * @return {Array<object>}        The merged form, followed by the folded form when folding applies.
 */
function createRuleListForms (rules) {
  const foldedRules = foldRepeatedMediaRules(rules);
  if (foldedRules.length === rules.length) {
    return [createRuleListForm(rules)];
  }
  // The passes mutate the rules they receive, so the folded form gets its own copy before the merged form is optimized
  const foldedCopy = cloneSyntaxTree(foldedRules);
  return [
    createRuleListForm(rules),
    createRuleListForm(foldedCopy)
  ];
}

/**
 * Stringifies the forms that have not been stringified yet, when there are two
 * forms to compare. The merged form reuses the strings of the rules it shares
 * with the folded form.
 *
 * @param {Array<object>} forms    The optimized forms.
 * @param {object}        context  The minification context used to stringify the rules.
 */
function stringifyFormsToCompare (forms, context) {
  const [mergedForm, foldedForm] = forms;
  if (!foldedForm) {
    return;
  }
  foldedForm.ruleStrings = foldedForm.ruleStrings || stringifyRuleList(foldedForm.rules, context);
  mergedForm.ruleStrings = mergedForm.ruleStrings || stringifyRuleListReusing(
    mergedForm.rules,
    foldedForm.rules,
    foldedForm.ruleStrings,
    context
  );
}

/**
 * Picks the form with the shorter output, preferring the merged form when
 * there is only one form or both are the same size.
 *
 * @param  {Array<object>} forms    The optimized forms.
 * @param  {object}        context  The minification context used to stringify the rules.
 * @return {object}                 The chosen form.
 */
function chooseShorterForm (forms, context) {
  stringifyFormsToCompare(forms, context);
  const [mergedForm, foldedForm] = forms;
  if (foldedForm && measureRuleStrings(foldedForm.ruleStrings) < measureRuleStrings(mergedForm.ruleStrings)) {
    return foldedForm;
  }
  return mergedForm;
}

/**
 * Optimizes a list of sibling entries, trying each of its forms and keeping
 * the one with the shorter output.
 *
 * @param  {Array}  rules    The AST rule nodes to optimize.
 * @param  {object} context  The minification context used to measure the output.
 * @return {Array}           The optimized rules.
 */
function optimizeAndMeasureRuleList (rules, context) {
  const forms = createRuleListForms(rules);
  for (const form of forms) {
    form.rules = runOptimizationPassesFrom(0, form.input, context, null);
  }
  return chooseShorterForm(forms, context).rules;
}

/**
 * Reports whether a memoized optimized list can stand in for optimizing the
 * list again under the current partial shorthand guard. A list optimized under
 * the guard without holding anything back would come out the same with the
 * guard lifted.
 *
 * @param  {object}  entry  The memoized entry.
 * @return {boolean}        True when the entry can be reused.
 */
function isReusableUnderCurrentGuard (entry) {
  const guardEnforced = isPartialShorthandGuardEnforced();
  return entry.guardEnforced === guardEnforced || (entry.guardEnforced && !entry.heldBackMerges);
}

/**
 * Optimizes a list of sibling entries, such as the rules inside a grouping
 * at-rule, which later passes may still rewrite. A list with the same content
 * as one already optimized during this stylesheet is handed a fresh copy of
 * that list's optimized form instead of being optimized again.
 *
 * @param  {Array}  rules         The AST rule nodes to optimize.
 * @param  {object} context       The minification context used to measure the output.
 * @param  {string} [contentKey]  The JSON form of the rules, when already known.
 * @return {Array}                The optimized rules.
 */
function optimizeRuleList (rules, context, contentKey = JSON.stringify(rules)) {
  const cachedEntry = optimizedRuleListsByContent.get(contentKey);
  if (cachedEntry && isReusableUnderCurrentGuard(cachedEntry)) {
    if (cachedEntry.heldBackMerges) {
      recordHeldBackPartialShorthandMerge();
    }
    return cloneSyntaxTree(cachedEntry.rules);
  }
  const heldBackBefore = countHeldBackPartialShorthandMerges();
  const optimized = optimizeAndMeasureRuleList(rules, context);
  optimizedRuleListsByContent.set(contentKey, {
    rules: cloneSyntaxTree(optimized),
    guardEnforced: isPartialShorthandGuardEnforced(),
    heldBackMerges: countHeldBackPartialShorthandMerges() !== heldBackBefore
  });
  return optimized;
}

/**
 * Optimizes every form of the top-level rules with merges that split a partial
 * shorthand held back, recording on each form where its pipeline would first
 * run differently with those merges allowed.
 *
 * @param  {Array<object>} forms    The forms of the top-level rules.
 * @param  {object}        context  The minification context.
 * @return {Array}                  The minified CSS string of each rule of the shorter form.
 */
function optimizeFormsWithGuard (forms, context) {
  setPartialShorthandGuard(true);
  for (const form of forms) {
    form.rules = runOptimizationPassesFrom(0, form.input, context, form);
  }
  const chosenForm = chooseShorterForm(forms, context);
  chosenForm.ruleStrings = chosenForm.ruleStrings || stringifyRuleList(chosenForm.rules, context);
  return chosenForm.ruleStrings;
}

/**
 * Optimizes the forms of the top-level rules again with merges that split a
 * partial shorthand allowed. Each form only reruns its pipeline from the first
 * pass that held such a merge back, and a form that never held one back keeps
 * the rules and strings it already has, since lifting the guard would not
 * have changed any of it.
 *
 * @param  {Array<object>} forms    The forms of the top-level rules, already optimized with the guard enforced.
 * @param  {object}        context  The minification context.
 * @return {Array}                  The minified CSS string of each rule of the shorter form.
 */
function optimizeFormsWithoutGuard (forms, context) {
  setPartialShorthandGuard(false);
  // Rerunning part of the pipeline leaves most rules as they were, so the
  // rules of every form already stringified lend their strings to the reruns
  const knownRuleStrings = new Map();
  for (const form of forms) {
    if (form.ruleStrings) {
      addKnownRuleStrings(knownRuleStrings, form.rules, form.ruleStrings);
    }
  }
  for (const form of forms) {
    if (form.resumePoint) {
      const { passIndex, rules } = form.resumePoint;
      form.rules = runOptimizationPassesFrom(passIndex, rules, context, null);
      form.ruleStrings = stringifyRuleListFromKnown(form.rules, knownRuleStrings, context);
    }
  }
  const chosenForm = chooseShorterForm(forms, context);
  chosenForm.ruleStrings = chosenForm.ruleStrings || stringifyRuleList(chosenForm.rules, context);
  return chosenForm.ruleStrings;
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
  const forms = createRuleListForms(rules);
  const guardedOutput = optimizeFormsWithGuard(forms, context);
  if (!wasPartialShorthandMergeBlocked()) {
    return guardedOutput;
  }
  const unguardedOutput = optimizeFormsWithoutGuard(forms, context);
  return measureRuleStrings(unguardedOutput) < measureRuleStrings(guardedOutput) ? unguardedOutput : guardedOutput;
}

export {
  clearOptimizationCaches,
  optimizeAndStringifyRuleList
};

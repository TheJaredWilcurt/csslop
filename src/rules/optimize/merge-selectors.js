/**
 * @file Merges rules that share a selector, placing the merged rule wherever the cascade reads it the same way it read the two rules apart.
 */

import {
  expandToOverridableProperties,
  isImportantDeclaration,
  isPropertyDeclaration
} from './declaration-writes.js';
import { createOverrideIndex } from './override-index.js';
import { normalizeSelector } from './selector-normalization.js';

/**
 * Builds the key two rules must share to be considered the same selector.
 *
 * @param  {object} rule  The AST rule node.
 * @return {string}       The normalized, order independent selector key.
 */
function buildSelectorKey (rule) {
  if (!rule.selectors) {
    return '';
  }
  return rule.selectors
    .map((selector) => {
      return normalizeSelector(selector);
    })
    .sort()
    .join(',');
}

/**
 * Returns a rule's selector key, building it the first time it is needed. A
 * merge only ever grows a rule's declarations, never its selectors, so a key
 * stays valid for every pass of the merge.
 *
 * @param  {object} rule               The AST rule node.
 * @param  {Map}    selectorKeyByRule  The selector keys already built, shared by every pass of one merge.
 * @return {string}                    The normalized, order independent selector key.
 */
function getSelectorKey (rule, selectorKeyByRule) {
  let selectorKey = selectorKeyByRule.get(rule);
  if (selectorKey === undefined) {
    selectorKey = buildSelectorKey(rule);
    selectorKeyByRule.set(rule, selectorKey);
  }
  return selectorKey;
}

/**
 * Placement for a merged rule whose combined declarations belong where the
 * later of the two rules was, because the earlier declarations moved down.
 *
 * @type {string}
 */
const MERGE_AT_LATER_RULE = 'later';

/**
 * Placement for a merged rule whose combined declarations belong where the
 * earlier of the two rules was, because the later declarations moved up.
 *
 * @type {string}
 */
const MERGE_AT_EARLIER_RULE = 'earlier';

/**
 * Finds which declaration decides each leaf property once a list of
 * declarations is read as one rule's body. Within a rule, an important
 * declaration beats a non-important one, and between two of equal weight the
 * last one written wins.
 *
 * @param  {Array} declarations  The declarations of the combined rule, in the order they would be written.
 * @return {Map}                 Map of leaf property name to the declaration that decides it.
 */
function findDecidingDeclarations (declarations) {
  const decidingDeclarations = new Map();
  const importantDeclarations = new Set();
  for (const declaration of declarations) {
    if (!isPropertyDeclaration(declaration)) {
      continue;
    }
    const isImportant = isImportantDeclaration(declaration);
    if (isImportant) {
      importantDeclarations.add(declaration);
    }
    for (const leafProperty of expandToOverridableProperties(declaration.property)) {
      const decidingDeclaration = decidingDeclarations.get(leafProperty);
      const outranksIt = (
        !decidingDeclaration ||
        isImportant ||
        !importantDeclarations.has(decidingDeclaration)
      );
      if (outranksIt) {
        decidingDeclarations.set(leafProperty, declaration);
      }
    }
  }
  return decidingDeclarations;
}

/**
 * Reports whether anything a rule brings to a merge still decides a property
 * of the combined rule. A declaration that loses every property it writes to
 * another declaration of the same rule is dropped from the merged rule, so
 * where the merged rule sits cannot change how it reads.
 *
 * @param  {object}  rule                  The rule contributing the entries.
 * @param  {Map}     decidingDeclarations  The deciding declaration of each leaf property of the merged rule.
 * @return {boolean}                       True when the rule still decides something after the merge.
 */
function decidesAnythingAfterMerge (rule, decidingDeclarations) {
  return (rule.declarations || []).some((entry) => {
    if (!isPropertyDeclaration(entry)) {
      return entry.type !== 'whitespace' && entry.type !== 'comment';
    }
    return [...expandToOverridableProperties(entry.property)].some((leafProperty) => {
      return decidingDeclarations.get(leafProperty) === entry;
    });
  });
}

/**
 * Decides where two rules with the same selector can be combined. Merging them
 * always makes one set of declarations cross whatever separates the two rules,
 * which can flip a conflict the crossing declarations used to win or lose, so
 * the merged rule goes wherever the set that moved keeps its old standing.
 * Nothing separates adjacent rules, so those always merge.
 *
 * The declarations one rule loses to the other are the exception: they are
 * dropped from the merged rule, so the merged rule belongs wherever the
 * declarations that outlive the merge already were, and nothing has to cross
 * anything at all. That is what lets `.a{color:red!important}` swallow a later
 * `.a{color:tan}` across a rule that also writes `color`.
 *
 * @param  {object}      overrideIndex    The index of what each position writes to.
 * @param  {object}      earlierRule      The first of the two rules with this selector.
 * @param  {object}      laterRule        The second of the two rules with this selector.
 * @param  {number}      earlierPosition  The slot the earlier rule occupies.
 * @param  {number}      laterPosition    The slot the later rule would occupy.
 * @return {string|null}                  Where to place the merged rule, or null when merging is unsafe.
 */
function chooseMergePlacement (overrideIndex, earlierRule, laterRule, earlierPosition, laterPosition) {
  const rulesAreAdjacent = earlierPosition === laterPosition - 1;
  if (rulesAreAdjacent) {
    return MERGE_AT_LATER_RULE;
  }
  const decidingDeclarations = findDecidingDeclarations([
    ...(earlierRule.declarations || []),
    ...(laterRule.declarations || [])
  ]);
  if (!decidesAnythingAfterMerge(laterRule, decidingDeclarations)) {
    return MERGE_AT_EARLIER_RULE;
  }
  if (!decidesAnythingAfterMerge(earlierRule, decidingDeclarations)) {
    return MERGE_AT_LATER_RULE;
  }
  if (!overrideIndex.blocksRelocation(earlierRule, earlierPosition)) {
    return MERGE_AT_LATER_RULE;
  }
  if (!overrideIndex.blocksRelocation(laterRule, earlierPosition)) {
    return MERGE_AT_EARLIER_RULE;
  }
  return null;
}

/**
 * Merges rules with identical normalized selectors by combining their declarations, as long as `chooseMergePlacement` finds a spot for the combined rule that the cascade reads the same way. Non-rule entries that affect the cascade (like `@media`) break the merge window, while comments do not, since comments never influence how declarations apply.
 *
 * @param  {Array}  rules        The AST rule nodes to merge.
 * @param  {object} mergeCaches  The write profiles and selector keys shared by every pass of one merge.
 * @return {Array}               A new array of rules with same-selector rules combined.
 */
function mergeSelectorRulePass (rules, mergeCaches) {
  // A rule merged at the later of the two positions moves to the end of the
  // output. Its old slot is emptied instead of spliced out so that every
  // recorded position stays valid, and the position map locates that slot
  // without searching the output.
  const slots = [];
  const positionByRule = new Map();
  const selectorMap = new Map();
  const overrideIndex = createOverrideIndex(mergeCaches.profileByRule);
  for (const rule of rules) {
    if (rule.type === 'whitespace') {
      continue;
    }
    if (rule.type !== 'rule') {
      slots.push(rule);
      // Clearing a map replaces its storage, so already empty maps are left alone
      if (rule.type !== 'comment' && selectorMap.size) {
        selectorMap.clear();
        positionByRule.clear();
      }
      continue;
    }
    const selectorKey = getSelectorKey(rule, mergeCaches.selectorKeyByRule);
    const existingRule = selectorKey && selectorMap.get(selectorKey);
    if (existingRule) {
      const existingPosition = positionByRule.get(existingRule);
      const mergedPosition = slots.length;
      const placement = chooseMergePlacement(overrideIndex, existingRule, rule, existingPosition, mergedPosition);
      if (placement) {
        existingRule.declarations.push(...(rule.declarations || []));
        overrideIndex.absorbRule(existingRule, rule);
        if (placement === MERGE_AT_LATER_RULE) {
          slots[existingPosition] = null;
          positionByRule.set(existingRule, mergedPosition);
          slots.push(existingRule);
          overrideIndex.recordRule(existingRule, mergedPosition);
        } else {
          // The merged declarations now live at the earlier slot, but they are
          // recorded at the later one, since the index is only ever appended
          // to. Reading them as later than they are can only hold back a
          // further merge, never allow an unsafe one.
          overrideIndex.recordRule(rule, mergedPosition);
        }
        continue;
      }
    }
    selectorMap.set(selectorKey, rule);
    positionByRule.set(rule, slots.length);
    overrideIndex.recordRule(rule, slots.length);
    slots.push(rule);
  }
  return slots.filter((slot) => {
    return slot !== null;
  });
}

/**
 * Reconsiders blocked pairs after merges relocate the rules that blocked them.
 * Each productive pass removes a rule, so this reaches a fixed point without
 * rerunning parsing or unrelated optimizations.
 *
 * @param  {Array} rules  The sibling rules to merge.
 * @return {Array}        Rules with all currently safe same-selector merges.
 */
function mergeSelectorRules (rules) {
  const mergeCaches = {
    profileByRule: new Map(),
    selectorKeyByRule: new Map()
  };
  let previousRules = rules;
  let mergedRules = mergeSelectorRulePass(previousRules, mergeCaches);
  while (mergedRules.length < previousRules.length) {
    previousRules = mergedRules;
    mergedRules = mergeSelectorRulePass(previousRules, mergeCaches);
  }
  return mergedRules;
}

export {
  mergeSelectorRules
};

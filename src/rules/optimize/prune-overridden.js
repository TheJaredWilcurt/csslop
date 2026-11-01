/**
 * @file Removes the selectors and declarations of multi-selector rules that later rules override in full, since they no longer decide anything.
 */

import {
  expandToOverridableProperties,
  isImportantDeclaration
} from './declaration-writes.js';
import { normalizeSelector } from './selector-normalization.js';

/**
 * Indexes, for every normalized selector in the stylesheet, the last rule that
 * declares each property under it. Comparing that index against a rule's own
 * position answers "is this selector's property overridden later" in constant
 * time, instead of rescanning and renormalizing every following rule.
 *
 * @param  {Array} rules  The flat list of AST rule nodes.
 * @return {Map}          Map of normalized selector to a map of property name to its last declaring rule index.
 */
function indexLastDeclaringRuleBySelector (rules) {
  const lastRuleIndexBySelector = new Map();
  rules.forEach((rule, ruleIndex) => {
    if (rule.type !== 'rule' || !rule.selectors) {
      return;
    }
    const declaredProperties = (rule.declarations || []).filter((declaration) => {
      return declaration.type === 'declaration';
    }).map((declaration) => {
      return declaration.property;
    });
    if (declaredProperties.length === 0) {
      return;
    }
    for (const selector of rule.selectors) {
      const normalizedSelector = normalizeSelector(selector);
      let lastRuleIndexByProperty = lastRuleIndexBySelector.get(normalizedSelector);
      if (!lastRuleIndexByProperty) {
        lastRuleIndexByProperty = new Map();
        lastRuleIndexBySelector.set(normalizedSelector, lastRuleIndexByProperty);
      }
      for (const property of declaredProperties) {
        lastRuleIndexByProperty.set(property, ruleIndex);
      }
    }
  });
  return lastRuleIndexBySelector;
}

/**
 * Checks whether a given selector has a specific property overridden
 * by any later rule in the stylesheet. A property is considered
 * overridden if a subsequent rule contains that selector (as its only
 * selector or among its selectors) and declares the same property.
 *
 * @param  {Map}     lastRuleIndexBySelector  The index built by `indexLastDeclaringRuleBySelector`.
 * @param  {number}  startIndex               The index of the current rule (search starts after this).
 * @param  {string}  selector                 The normalized selector to check.
 * @param  {string}  property                 The CSS property name to check.
 * @return {boolean}                          True if a later rule overrides this selector+property.
 */
function isSelectorPropertyOverriddenLater (lastRuleIndexBySelector, startIndex, selector, property) {
  const lastRuleIndex = lastRuleIndexBySelector.get(selector)?.get(property);
  return lastRuleIndex !== undefined && lastRuleIndex > startIndex;
}

/**
 * Indexes, for every normalized selector in the stylesheet, the last rule that
 * covers each leaf property under it, where coverage follows the same "writes
 * to" model as `expandToOverridableProperties` (a later `border` declaration
 * on the same selector also overrides an earlier `border-color` on it), along
 * with whether that covering declaration is important. A last-covering entry
 * is consulted to answer "is every declaration this selector still gets from
 * the rule at position X re-declared later".
 *
 * @param  {Array} rules  The flat list of AST rule nodes.
 * @return {Map}          Map of normalized selector to a map of covered leaf property name to `{ ruleIndex, important }`.
 */
function indexFinalCoveringRuleBySelector (rules) {
  const coverageBySelector = new Map();
  rules.forEach((rule, ruleIndex) => {
    if (rule.type !== 'rule' || !rule.selectors?.length) {
      return;
    }
    const declarations = (rule.declarations || []).filter((declaration) => {
      return declaration.type === 'declaration' && declaration.property;
    });
    if (!declarations.length) {
      return;
    }
    for (const selector of rule.selectors) {
      const normalizedSelector = normalizeSelector(selector);
      let coverageByProperty = coverageBySelector.get(normalizedSelector);
      if (!coverageByProperty) {
        coverageByProperty = new Map();
        coverageBySelector.set(normalizedSelector, coverageByProperty);
      }
      for (const declaration of declarations) {
        const important = isImportantDeclaration(declaration);
        for (const leafProperty of expandToOverridableProperties(declaration.property)) {
          coverageByProperty.set(leafProperty, { important, ruleIndex });
        }
      }
    }
  });
  return coverageBySelector;
}

/**
 * Determines whether a later rule overrides every leaf property an earlier
 * declaration writes to for the same selector, including via shorthand
 * coverage, with an important earlier write requiring an important later
 * write to beat it.
 *
 * @param  {Map}     coverageByProperty      The leaf property coverage index for the selector.
 * @param  {object}  declaration             The earlier declaration to test.
 * @param  {number}  ruleIndex               The position of the rule holding the declaration.
 * @param  {boolean} declarationIsImportant  Whether the earlier write of this property is important.
 * @return {boolean}                         True when the declaration is conclusively overridden later.
 */
function isDeclarationOverriddenLater (coverageByProperty, declaration, ruleIndex, declarationIsImportant) {
  for (const leafProperty of expandToOverridableProperties(declaration.property)) {
    const coverage = coverageByProperty.get(leafProperty);
    if (!coverage || coverage.ruleIndex <= ruleIndex) {
      return false;
    }
    // An important declaration outlives a later non-important one
    if (declarationIsImportant && !coverage.important) {
      return false;
    }
  }
  return true;
}

/**
 * Removes a selector from a multi-selector rule's list when every declaration
 * the rule would still give that selector is overridden by a later rule that
 * contains the same selector. For example, if `h1,h2{color:red}` is followed
 * by `h2{color:tan}`, the `h2` entry contributes nothing and can be dropped,
 * leaving `h1{color:red}`. If the list empties out entirely, the rule is
 * stripped of declarations so `removeEmptyRules` discards it.
 *
 * @param  {Array} rules  The flat list of AST rule nodes.
 * @return {Array}        The rules with fully overridden selectors removed from their lists.
 */
function removeFullyOverriddenSelectors (rules) {
  // Pruning a selector only ever shrinks lists: a covering entry that wins
  // today is supplied by a later rule, and pruning earlier rules never moves
  // coverage forward, so a single index built up front stays accurate.
  const coverageBySelector = indexFinalCoveringRuleBySelector(rules);

  for (let ruleIndex = 0; ruleIndex < rules.length; ruleIndex++) {
    const rule = rules[ruleIndex];
    if (rule.type !== 'rule' || !rule.selectors || rule.selectors.length < 2) {
      continue;
    }
    const entries = rule.declarations || [];
    // Removing a selector would also un-scope nested rules, which may depend
    // on it, so only rules made purely of declarations qualify
    const hasNestedContent = entries.some((entry) => {
      return entry.type !== 'declaration' && entry.type !== 'whitespace' && entry.type !== 'comment';
    });
    if (hasNestedContent) {
      continue;
    }
    const declarations = entries.filter((entry) => {
      return entry.type === 'declaration' && entry.property;
    });
    if (!declarations.length) {
      continue;
    }
    // Within a rule, any important declaration of a property makes the rule's
    // write of that property important (a conservative stand-in for tracking
    // which of several same-property declarations survives inside the rule)
    const importantByProperty = new Map();
    for (const declaration of declarations) {
      if (isImportantDeclaration(declaration)) {
        importantByProperty.set(declaration.property, true);
      } else if (!importantByProperty.has(declaration.property)) {
        importantByProperty.set(declaration.property, false);
      }
    }
    const keptSelectors = rule.selectors.filter((selector) => {
      const coverageByProperty = coverageBySelector.get(normalizeSelector(selector));
      if (!coverageByProperty) {
        return true;
      }
      // Keep the selector while at least one declaration is not conclusively
      // overridden for it by a later rule
      return declarations.some((declaration) => {
        return !isDeclarationOverriddenLater(
          coverageByProperty,
          declaration,
          ruleIndex,
          importantByProperty.get(declaration.property)
        );
      });
    });
    if (keptSelectors.length !== rule.selectors.length) {
      if (!keptSelectors.length) {
        rule.declarations = entries.filter((entry) => {
          return entry.type !== 'declaration';
        });
      }
      rule.selectors = keptSelectors;
    }
  }
  return rules;
}

/**
 * Removes properties from multi-selector rules when every selector in
 * the rule has that property overridden by a later rule. For example,
 * if `h1,h2{color:red}` is followed by `h1{color:blue}` and
 * `h2{color:green}`, the `color` in the first rule is redundant and
 * can be removed. If all properties are removed, the empty rule will
 * be cleaned up by `removeEmptyRules`.
 *
 * @param  {Array} rules  The flat list of AST rule nodes.
 * @return {Array}        The rules with overridden multi-selector properties removed.
 */
function removeOverriddenMultiSelectorProperties (rules) {
  // Only rules that follow the one being pruned are ever consulted, and pruning
  // never adds a declaration, so a single index built up front stays accurate.
  const lastRuleIndexBySelector = indexLastDeclaringRuleBySelector(rules);

  for (let ruleIndex = 0; ruleIndex < rules.length; ruleIndex++) {
    const rule = rules[ruleIndex];
    if (rule.type !== 'rule' || !rule.selectors || rule.selectors.length < 2) {
      continue;
    }
    const normalizedSelectors = rule.selectors.map(normalizeSelector);
    const declarations = (rule.declarations || []).filter((declaration) => {
      return declaration.type === 'declaration';
    });
    if (declarations.length === 0) {
      continue;
    }

    // For each property in this multi-selector rule, check if ALL selectors
    // get that property overridden in later rules
    const propertiesToRemove = new Set();
    for (const declaration of declarations) {
      const property = declaration.property;
      const allSelectorsOverridden = normalizedSelectors.every((selector) => {
        return isSelectorPropertyOverriddenLater(lastRuleIndexBySelector, ruleIndex, selector, property);
      });
      if (allSelectorsOverridden) {
        propertiesToRemove.add(property);
      }
    }

    if (propertiesToRemove.size > 0) {
      rule.declarations = (rule.declarations || []).filter((declaration) => {
        if (declaration.type !== 'declaration') {
          return true;
        }
        return !propertiesToRemove.has(declaration.property);
      });
    }
  }
  return rules;
}

export {
  removeFullyOverriddenSelectors,
  removeOverriddenMultiSelectorProperties
};

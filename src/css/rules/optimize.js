/**
 * @file Optimizes CSS rule structures by merging selectors, deduplicating keyframes, nesting flat rules, and consolidating `@media` and `@layer` blocks.
 */

import { escapeRegexString } from '../utilities.js';

import { normalizeMedia } from './normalize.js';

/**
 * Expands rules that contain only nested sub-rules into flat rules with combined selectors, enabling further merging when the combined selectors already exist elsewhere.
 *
 * @param  {Array} rules  The AST rule nodes to process.
 * @return {Array}        A new array of rules with pure-nested rules expanded.
 */
function expandPureNestedRules (rules) {
  const flatSelectors = new Set();
  for (const rule of rules) {
    if (rule.type !== 'rule' || !rule.selectors?.length) {
      continue;
    }
    const nonWhitespace = (rule.declarations || []).filter((declaration) => {
      return declaration.type !== 'whitespace';
    });
    const hasNonRuleDeclarations = nonWhitespace.some((declaration) => {
      return declaration.type !== 'rule';
    });
    if (hasNonRuleDeclarations) {
      rule.selectors.forEach((selector) => {
        flatSelectors.add(selector.trim().replace(/\s+/g, ' '));
      });
    }
  }

  const result = [];
  for (const rule of rules) {
    if (rule.type !== 'rule' || !rule.selectors?.length) {
      result.push(rule);
      continue;
    }
    const nonWhitespace = (rule.declarations || []).filter((declaration) => {
      return declaration.type !== 'whitespace';
    });
    const isPureNested = nonWhitespace.length > 0 && nonWhitespace.every((declaration) => {
      return declaration.type === 'rule';
    });
    if (!isPureNested) {
      result.push(rule);
      continue;
    }

    let anyMatch = false;
    let expandedRules = [];
    let canExpand = true;

    for (const nestedRule of nonWhitespace) {
      if (!nestedRule.selectors?.length) {
        canExpand = false;
        break;
      }
      const combinedSelectors = [];
      for (const parentSelector of rule.selectors) {
        for (const childSelector of nestedRule.selectors) {
          const trimmedChild = childSelector.trim();
          let combinedSelector;
          if (trimmedChild.startsWith('&')) {
            combinedSelector = trimmedChild.replace(/^&/, parentSelector.trim());
          } else {
            combinedSelector = parentSelector.trim() + ' ' + trimmedChild;
          }
          combinedSelectors.push(combinedSelector);
          if (flatSelectors.has(combinedSelector)) {
            anyMatch = true;
          }
        }
      }
      expandedRules.push({ ...nestedRule, selectors: combinedSelectors });
    }

    const allChildSelectorStrings = expandedRules.map((expandedRule) => {
      return expandedRule.selectors.join(',');
    });
    const allSame = (
      allChildSelectorStrings.length > 0 &&
      allChildSelectorStrings.every((selectorString) => {
        return selectorString === allChildSelectorStrings[0];
      })
    );
    if (canExpand && (allSame || anyMatch)) {
      for (const expandedRule of expandedRules) {
        result.push(expandedRule);
      }
    } else {
      result.push(rule);
    }
  }
  return result;
}

/**
 * Attempts to express a child selector as a nested selector relative to a parent, returning the nested form or null if nesting is not possible.
 *
 * @param  {string}      parentSel  The parent selector string.
 * @param  {string}      childSel   The child selector string to try nesting.
 * @return {string|null}            The nested selector using & syntax, or null if the child cannot be nested under the parent.
 */
function tryNestSelector (parentSel, childSel) {
  const parent = parentSel.trim();
  const child = childSel.trim();
  if (child.startsWith(parent + ':') || child.startsWith(parent + '::')) {
    return '&' + child.slice(parent.length);
  }
  if (child.startsWith(parent + ' ')) {
    return child.slice(parent.length + 1);
  }
  const combinatorMatch = child.match(
    new RegExp('^' + escapeRegexString(parent) + '\\s*([>+~])\\s*(.+)$')
  );
  if (combinatorMatch) {
    return combinatorMatch[1] + combinatorMatch[2];
  }
  return null;
}

/**
 * Groups flat CSS rules into nested structures where a child selector can be expressed relative to a preceding parent, reducing output size through CSS nesting.
 *
 * @param  {Array} rules  The flat AST rule nodes to nest.
 * @return {Array}        A new array of rules with applicable children nested under their parents.
 */
function nestFlatRules (rules) {
  const result = [];
  for (const rule of rules) {
    if (rule.type !== 'rule' || rule.selectors?.length !== 1) {
      result.push(rule);
      continue;
    }
    const childSelector = rule.selectors[0].trim();
    let wasNested = false;
    for (let j = result.length - 1; j >= 0; j--) {
      const parentRule = result[j];
      if (parentRule.type !== 'rule' || parentRule.selectors?.length !== 1) {
        continue;
      }
      const nestedSelector = tryNestSelector(parentRule.selectors[0], childSelector);
      if (nestedSelector !== null) {
        parentRule.declarations = parentRule.declarations || [];
        parentRule.declarations.push({ ...rule, selectors: [nestedSelector] });
        wasNested = true;
        break;
      }
    }
    if (!wasNested) {
      result.push(rule);
    }
  }
  for (const rule of result) {
    if (rule.type === 'rule' && rule.declarations) {
      const innerRules = rule.declarations.filter((declaration) => {
        return declaration.type === 'rule';
      });
      if (innerRules.length > 0) {
        const nonRuleDeclarations = rule.declarations.filter((declaration) => {
          return declaration.type !== 'rule';
        });
        rule.declarations = [...nonRuleDeclarations, ...nestFlatRules(innerRules)];
      }
    }
  }
  return result;
}

/**
 * Merges adjacent `@media` rules that share an identical normalized query string and deduplicates their child selector rules.
 *
 * @param  {Array}                  rules               The AST rule nodes to process.
 * @param  {function(Array): Array} mergeSelectorRules  Callback to merge selector rules within each media block.
 * @return {Array}                                      A new array of rules with consecutive identical `@media` blocks combined.
 */
function mergeMediaRules (rules, mergeSelectorRules) {
  const mediaMap = new Map();
  const result = [];
  for (const rule of rules) {
    if (rule.type === 'media') {
      const normalizedQuery = normalizeMedia(rule.media);
      if (mediaMap.has(normalizedQuery)) {
        mediaMap.get(normalizedQuery).rules.push(...(rule.rules || []));
      } else {
        mediaMap.set(normalizedQuery, rule);
        result.push(rule);
      }
    } else {
      if (rule.type !== 'whitespace') {
        mediaMap.clear();
      }
      result.push(rule);
    }
  }
  for (const rule of result) {
    if (rule.type === 'media' && rule.rules && rule.rules.length) {
      rule.rules = mergeSelectorRules(rule.rules);
    }
  }
  return result;
}

/**
 * Removes duplicate `@keyframes` definitions, keeping only the last occurrence of each named animation.
 *
 * @param  {Array} rules  The AST rule nodes to deduplicate.
 * @return {Array}        A new array of rules with earlier duplicate `@keyframes` removed.
 */
function deduplicateKeyframes (rules) {
  const lastIndexByName = new Map();
  for (let i = 0; i < rules.length; i++) {
    if (rules[i].type === 'keyframes' && rules[i].name) {
      lastIndexByName.set(rules[i].name, i);
    }
  }
  return rules.filter((rule, index) => {
    if (rule.type === 'keyframes' && rule.name) {
      return lastIndexByName.get(rule.name) === index;
    }
    return true;
  });
}

/**
 * Merges consecutive rules whose declarations are a subset of the following rule, combining their selectors and splitting out any extra declarations.
 *
 * @param  {Array} rules  The AST rule nodes to merge.
 * @return {Array}        A new array of rules with declaration-compatible consecutive rules combined.
 */
function mergeByDeclarations (rules) {
  const result = [];
  for (const rule of rules) {
    if (rule.type !== 'rule' || !rule.selectors?.length) {
      result.push(rule);
      continue;
    }
    const previousRule = result[result.length - 1];
    if (previousRule && previousRule.type === 'rule' && previousRule.selectors?.length) {
      const previousDeclarations = (previousRule.declarations || []).filter((declaration) => {
        return declaration.type !== 'whitespace' && declaration.property;
      });
      const currentDeclarations = (rule.declarations || []).filter((declaration) => {
        return declaration.type !== 'whitespace' && declaration.property;
      });
      if (previousDeclarations.length > 0 && currentDeclarations.length > 0) {
        const currentDeclarationMap = new Map(
          currentDeclarations.map((declaration) => {
            return [declaration.property, (declaration.value || '').trim()];
          })
        );
        const previousIsSubset = previousDeclarations.every((declaration) => {
          return currentDeclarationMap.get(declaration.property) === (declaration.value || '').trim();
        });
        const currentHasAllProperty = currentDeclarations.some((declaration) => {
          return declaration.property === 'all';
        });
        if (previousIsSubset && !currentHasAllProperty) {
          const commonProperties = new Set(
            previousDeclarations.map((declaration) => {
              return declaration.property;
            })
          );
          const currentOnlyDeclarations = currentDeclarations.filter((declaration) => {
            return !commonProperties.has(declaration.property);
          });
          result.pop();
          result.push({ ...previousRule, selectors: [...previousRule.selectors, ...rule.selectors] });
          if (currentOnlyDeclarations.length > 0) {
            result.push({ ...rule, declarations: currentOnlyDeclarations });
          }
          continue;
        }
      }
    }
    result.push(rule);
  }
  return result;
}

/**
 * Merges rules with identical normalized selectors by combining their declarations. Non-rule entries (like `@media`) break the merge window.
 *
 * @param  {Array} rules  The AST rule nodes to merge.
 * @return {Array}        A new array of rules with same-selector rules combined.
 */
function mergeSelectorRules (rules) {
  let result = [];
  let selectorMap = new Map();
  for (const rule of rules) {
    if (rule.type === 'rule') {
      const selectorKey = rule.selectors ?
        rule.selectors.map((selector) => {
          return selector.trim().replace(/\s+/g, ' ');
        }).sort().join(',') :
        '';
      if (selectorKey && selectorMap.has(selectorKey)) {
        const existingRule = selectorMap.get(selectorKey);
        existingRule.declarations.push(...(rule.declarations || []));
        result = result.filter((candidate) => {
          return candidate !== existingRule;
        });
        result.push(existingRule);
      } else {
        selectorMap.set(selectorKey, rule);
        result.push(rule);
      }
    } else {
      if (rule.type === 'whitespace') {
        continue;
      }
      result.push(rule);
      selectorMap.clear();
    }
  }
  return result;
}

/**
 * Merges `@layer` blocks with the same name by combining their child rules, deduplicates layer statements, and merges selector rules within each block.
 *
 * @param  {Array}                  rules               The AST rule nodes to process.
 * @param  {function(Array): Array} mergeSelectorRules  Callback to merge selector rules within each layer block.
 * @return {Array}                                      A new array of rules with same-name `@layer` blocks combined.
 */
function mergeLayerRules (rules, mergeSelectorRules) {
  const layerBlockMap = new Map();
  const layerStatementSeen = new Set();
  const result = [];
  for (const rule of rules) {
    if (rule.type === 'layer') {
      const layerName = rule.layer || '';
      if (rule.rules && rule.rules.length > 0) {
        if (layerName && layerBlockMap.has(layerName)) {
          layerBlockMap.get(layerName).rules.push(...rule.rules);
        } else {
          if (layerName) {
            layerBlockMap.set(layerName, rule);
          }
          result.push(rule);
        }
      } else {
        if (!layerName || !layerStatementSeen.has(layerName)) {
          if (layerName) {
            layerStatementSeen.add(layerName);
          }
          result.push(rule);
        }
      }
    } else {
      result.push(rule);
    }
  }
  for (const rule of result) {
    if (rule.type === 'layer' && rule.rules && rule.rules.length) {
      rule.rules = mergeSelectorRules(rule.rules);
    }
  }
  return result;
}

export {
  deduplicateKeyframes,
  expandPureNestedRules,
  mergeByDeclarations,
  mergeLayerRules,
  mergeMediaRules,
  mergeSelectorRules,
  nestFlatRules
};

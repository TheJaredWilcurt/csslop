/**
 * @file Expands nested rules into flat rules with combined selectors whenever that lets them merge with rules that already exist, and flattens `&` rules into their parent.
 */

import { tokenizeCssValue } from '../../parser/tokenizer.js';
import { containsPseudoElement } from '../selectors.js';

import { selectorsShareSpecificity } from './specificity.js';

/**
 * Reports whether an entry of a rule's body is itself a nested rule rather
 * than a plain declaration.
 *
 * @param  {object}  entry  An entry of a rule's declaration list.
 * @return {boolean}        True when the entry is a nested rule.
 */
function isNestedRule (entry) {
  return entry.type === 'rule';
}

/**
 * Expands the rules nested inside each rule's body, so a chain of wrappers
 * collapses from the inside out and the outermost wrapper is then judged
 * against an already flattened child. A rule's body holds the same kinds of
 * entries a stylesheet does, so the body is expanded by the same rules, and
 * the plain declarations it also holds pass through untouched.
 *
 * @param  {Array} rules  The AST rule nodes whose bodies may hold nested rules.
 * @return {Array}        The rules, each with its body expanded.
 */
function expandNestedRuleBodies (rules) {
  return rules.map((rule) => {
    if (rule.type !== 'rule' || !(rule.declarations || []).some(isNestedRule)) {
      return rule;
    }
    const declarations = expandPureNestedRules(rule.declarations);
    const canFlattenSelf = selectorsShareSpecificity(rule.selectors) && !rule.selectors.some(containsPseudoElement);
    let encounteredNestedContent = false;
    const flattened = declarations.flatMap((entry) => {
      const isSelfRule = entry.type === 'rule' && entry.selectors?.length === 1 && entry.selectors[0].trim() === '&';
      if (canFlattenSelf && isSelfRule && !encounteredNestedContent) {
        return entry.declarations || [];
      }
      if (entry.type !== 'declaration' && entry.type !== 'whitespace' && entry.type !== 'comment') {
        encounteredNestedContent = true;
      }
      if (entry.type === 'rule' && rule.selectors.length === 1) {
        entry.selectors = entry.selectors.map((selector) => {
          return shortenRepeatedNestingSelector(rule.selectors[0], selector);
        });
      }
      return [entry];
    });
    return {
      ...rule,
      declarations: flattened
    };
  });
}

/**
 * Replaces repetitions of a simple class or ID beside a leading nesting
 * selector. Token comparisons keep longer names and escaped text intact.
 *
 * @param  {string} parentSelector  The sole parent selector.
 * @param  {string} childSelector   The nested selector.
 * @return {string}                 The shorter equivalent selector.
 */
function shortenRepeatedNestingSelector (parentSelector, childSelector) {
  const parentTokens = tokenizeCssValue(parentSelector);
  const isClass = parentTokens.length === 2 && parentTokens[0].text === '.' && parentTokens[1].type === 'ident';
  const isIdentifier = parentTokens.length === 1 && parentTokens[0].type === 'hash';
  if (!isClass && !isIdentifier) {
    return childSelector;
  }
  const childTokens = tokenizeCssValue(childSelector);
  if (childTokens[0]?.text !== '&') {
    return childSelector;
  }
  let index = 1;
  let result = '&';
  while (index < childTokens.length) {
    const matchesParent = parentTokens.every((token, position) => {
      return childTokens[index + position]?.text === token.text;
    });
    if (!matchesParent) {
      break;
    }
    result += '&';
    index += parentTokens.length;
  }
  return result + childTokens.slice(index).map((token) => {
    return token.text;
  }).join('');
}

/**
 * Reports whether a nested child selector still means the same thing once it
 * is written out in full under its parent.
 *
 * @param  {string}  childSelector  The selector of a rule nested inside another.
 * @return {boolean}                True when the child can be written as a flat selector.
 */
function canFlattenChildSelector (childSelector) {
  const child = childSelector.trim();
  if (!child) {
    return false;
  }
  // A `&` anywhere but the very start puts the parent where flattening cannot:
  // `.b &` means the parent follows the child rather than leading it
  return !child.slice(1).includes('&');
}

/**
 * Writes a nested child selector out in full, as the selector it stands for
 * when read through its parent.
 *
 * @param  {string} parentSelector  The selector of the rule the child is nested in.
 * @param  {string} childSelector   The selector of the nested child rule.
 * @return {string}                 The flat selector the nested pair stands for.
 */
function combineNestedSelector (parentSelector, childSelector) {
  const parent = parentSelector.trim();
  const child = childSelector.trim();
  // A leading `&` names the parent itself, so it is what the parent replaces
  if (child.startsWith('&')) {
    return parent + child.slice(1);
  }
  return parent + ' ' + child;
}

/**
 * Expands rules that contain only nested sub-rules into flat rules with combined selectors, enabling further merging when the combined selectors already exist elsewhere.
 *
 * @param  {Array} inputRules  The AST rule nodes to process.
 * @return {Array}             A new array of rules with pure-nested rules expanded.
 */
function expandPureNestedRules (inputRules) {
  const rules = expandNestedRuleBodies(inputRules);
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
        // Normalize selector whitespace to single space for deduplication
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
    // A comma-separated parent selector list behaves like :is() for specificity,
    // so expanding it into descendant combinations (e.g. #a,.b → #a .c,.b .c)
    // would change specificity. Only single-selector parents can expand safely.
    if (!isPureNested || rule.selectors.length !== 1) {
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
      // A child written as a comma-separated selector list, such as `.b,.c`,
      // repeats the parent in front of every item when expanded (`.a .b,.a .c`),
      // while the nested form states the parent once. Expanding is always
      // longer, and leaving the rule nested keeps one pass from expanding what
      // the next pass would then keep, so the output stays idempotent.
      if (nestedRule.selectors.length > 1) {
        canExpand = false;
        break;
      }
      if (!nestedRule.selectors.every(canFlattenChildSelector)) {
        canExpand = false;
        break;
      }
      const combinedSelectors = [];
      for (const parentSelector of rule.selectors) {
        for (const childSelector of nestedRule.selectors) {
          const combinedSelector = combineNestedSelector(parentSelector, childSelector);
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

export {
  expandPureNestedRules
};

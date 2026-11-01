/**
 * @file Combines consecutive nested rules that share a declaration body and a specificity into one rule with a comma-separated selector list.
 */

import {
  compareSpecificity,
  maxSelectorSpecificity
} from './specificity.js';

/**
 * Builds a normalized signature of a rule's declaration body, or null when the
 * rule contains anything other than plain declarations (e.g. nested rules).
 *
 * @param  {object}      rule  The AST rule node.
 * @return {string|null}       The sorted "property:value" signature, or null.
 */
function nestedRuleBodySignature (rule) {
  const declarations = (rule.declarations || []).filter((declaration) => {
    return declaration.type !== 'whitespace' && declaration.type !== 'comment';
  });
  if (declarations.length === 0) {
    return null;
  }
  const isAllPlainDeclarations = declarations.every((declaration) => {
    return declaration.type === 'declaration' && declaration.property;
  });
  if (!isAllPlainDeclarations) {
    return null;
  }
  return declarations
    .map((declaration) => {
      return declaration.property + ':' + (declaration.value || '').trim();
    })
    .sort()
    .join(';');
}

/**
 * Determines whether two nested rules can be merged into a shared selector list.
 * They must have identical declaration bodies and the same specificity level,
 * since comma-separated nested selectors share the highest specificity of the
 * group (like `:is()`).
 *
 * @param  {object}  first   The first nested rule.
 * @param  {object}  second  The second nested rule.
 * @return {boolean}         Whether the two nested rules may be merged.
 */
function nestedRulesMergeable (first, second) {
  if (!first.selectors?.length || !second.selectors?.length) {
    return false;
  }
  const firstSignature = nestedRuleBodySignature(first);
  if (firstSignature === null || firstSignature !== nestedRuleBodySignature(second)) {
    return false;
  }
  const firstSpecificity = maxSelectorSpecificity(first.selectors.join(','));
  const secondSpecificity = maxSelectorSpecificity(second.selectors.join(','));
  return compareSpecificity(firstSpecificity, secondSpecificity) === 0;
}

/**
 * Recursively merges consecutive nested rules within a declaration list when
 * they share identical bodies and specificity, combining their selector lists.
 *
 * @param  {Array} declarations  The declaration/nested-rule entries of a parent rule.
 * @return {Array}               The declaration list with mergeable nested rules combined.
 */
function mergeConsecutiveNestedRules (declarations) {
  const recursed = declarations.map((declaration) => {
    if (declaration.type === 'rule' && declaration.declarations) {
      return { ...declaration, declarations: mergeConsecutiveNestedRules(declaration.declarations) };
    }
    return declaration;
  });

  const result = [];
  for (const declaration of recursed) {
    const previous = result[result.length - 1];
    if (
      declaration.type === 'rule' &&
      previous &&
      previous.type === 'rule' &&
      nestedRulesMergeable(previous, declaration)
    ) {
      result[result.length - 1] = {
        ...previous,
        selectors: [...previous.selectors, ...declaration.selectors]
      };
      continue;
    }
    result.push(declaration);
  }
  return result;
}

/**
 * Merges mergeable nested rules within every rule's body across the stylesheet,
 * recursing into `@media` and `@layer` blocks. Top-level rules are not merged
 * here, since only nested (comma-grouped) selectors share specificity.
 *
 * @param  {Array} rules  The AST rule nodes to process.
 * @return {Array}        The rules with mergeable nested rules combined.
 */
function mergeIdenticalNestedRules (rules) {
  for (const rule of rules) {
    if (rule.type === 'rule' && rule.declarations) {
      rule.declarations = mergeConsecutiveNestedRules(rule.declarations);
    } else if ((rule.type === 'media' || rule.type === 'layer') && rule.rules) {
      rule.rules = mergeIdenticalNestedRules(rule.rules);
    }
  }
  return rules;
}

export {
  mergeIdenticalNestedRules
};

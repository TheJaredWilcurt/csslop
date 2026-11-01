/**
 * @file Folds a rule into the rule that follows it when the later rule restates everything the earlier one declares, so the two can share a selector list.
 */

import { normalizeSelector } from './selector-normalization.js';
import { selectorsShareSpecificity } from './specificity.js';

/**
 * Removes duplicate selectors from a combined selector list by normalizing
 * whitespace and preserving the first occurrence of each unique selector.
 *
 * @param  {Array} selectors  The selector strings to deduplicate.
 * @return {Array}            A new array with duplicate selectors removed.
 */
function deduplicateSelectors (selectors) {
  const seen = new Set();
  return selectors.filter((selector) => {
    // Normalize whitespace to single spaces for consistent comparison
    const normalized = selector.trim().replace(/\s+/g, ' ');
    if (seen.has(normalized)) {
      return false;
    }
    seen.add(normalized);
    return true;
  });
}

/**
 * The rule body entries that style nothing themselves, and so have no say in
 * whether one rule's body is carried by another's.
 *
 * @type {Set<string>}
 */
const UNSTYLED_BODY_ENTRY_TYPES = new Set(['whitespace', 'comment']);

/**
 * Splits a rule body into the declarations it sets directly and the blocks
 * nested inside it, leaving out the entries that style nothing.
 *
 * @param  {Array}  declarations  The rule body entries.
 * @return {object}               The body's `plainDeclarations` and `nestedBlocks`.
 */
function partitionRuleBody (declarations) {
  const plainDeclarations = [];
  const nestedBlocks = [];
  for (const entry of declarations || []) {
    if (UNSTYLED_BODY_ENTRY_TYPES.has(entry.type)) {
      continue;
    }
    if (entry.property) {
      plainDeclarations.push(entry);
    } else {
      nestedBlocks.push(entry);
    }
  }
  return {
    nestedBlocks,
    plainDeclarations
  };
}

/**
 * Describes a block nested inside a rule precisely enough to tell whether two
 * rules nest the very same thing. Only plain nested rules can be described: an
 * at-rule nested in a rule carries a prelude that decides when its body applies,
 * so it is reported as indescribable rather than guessed at.
 *
 * @param  {object}      block  A block nested inside a rule body.
 * @return {string|null}        The signature, or null when the block cannot be described.
 */
function nestedBlockSignature (block) {
  if (block.type !== 'rule' || !block.selectors?.length) {
    return null;
  }
  const {
    nestedBlocks,
    plainDeclarations
  } = partitionRuleBody(block.declarations);
  const declarationParts = plainDeclarations.map((declaration) => {
    return declaration.property + ':' + (declaration.value || '').trim();
  });
  const nestedParts = nestedBlocksSignature(nestedBlocks);
  if (nestedParts === null) {
    return null;
  }
  const selectors = block.selectors.map(normalizeSelector).join(',');
  return selectors + '{' + declarationParts.join(';') + nestedParts + '}';
}

/**
 * Describes every block nested in a rule body as one comparable string, in the
 * order the blocks are written, since that order decides which of them wins a
 * conflict.
 *
 * @param  {Array}       nestedBlocks  The blocks nested in a rule body.
 * @return {string|null}               The combined signature, or null when any block cannot be described.
 */
function nestedBlocksSignature (nestedBlocks) {
  let combined = '';
  for (const block of nestedBlocks) {
    const signature = nestedBlockSignature(block);
    if (signature === null) {
      return null;
    }
    combined += signature;
  }
  return combined;
}

/**
 * Combines an earlier rule with the rule that follows it when everything the
 * earlier one styles is restated by the later one, so the earlier selector can
 * simply join the later rule's shared part and the remainder stays behind in a
 * rule of its own.
 *
 * Both rules have to nest the same blocks. A block nested in only one of them
 * would either be lost or start matching the other rule's selector, neither of
 * which the two rules said.
 *
 * @param  {object}     previousRule  The rule immediately in front of `rule`.
 * @param  {object}     rule          The rule being folded into its predecessor.
 * @return {Array|null}               The rules that replace the pair, or null when they cannot be combined.
 */
function mergeRuleIntoPredecessor (previousRule, rule) {
  const isMergeableRulePair = (
    previousRule?.type === 'rule' &&
    previousRule.selectors?.length &&
    rule.type === 'rule' &&
    rule.selectors?.length
  );
  if (!isMergeableRulePair) {
    return null;
  }
  const previousBody = partitionRuleBody(previousRule.declarations);
  const currentBody = partitionRuleBody(rule.declarations);
  if (!previousBody.plainDeclarations.length || !currentBody.plainDeclarations.length) {
    return null;
  }
  const previousNesting = nestedBlocksSignature(previousBody.nestedBlocks);
  const currentNesting = nestedBlocksSignature(currentBody.nestedBlocks);
  if (previousNesting === null || previousNesting !== currentNesting) {
    return null;
  }
  const currentValueByProperty = new Map(
    currentBody.plainDeclarations.map((declaration) => {
      return [declaration.property, (declaration.value || '').trim()];
    })
  );
  const previousIsRestated = previousBody.plainDeclarations.every((declaration) => {
    return currentValueByProperty.get(declaration.property) === (declaration.value || '').trim();
  });
  // `all` rewrites every other property, so the later rule restating a value is
  // no promise that it applies the same way once `all` has run.
  const currentResetsEverything = currentValueByProperty.has('all');
  if (!previousIsRestated || currentResetsEverything) {
    return null;
  }
  const combinedSelectors = deduplicateSelectors([...previousRule.selectors, ...rule.selectors]);
  if (previousBody.nestedBlocks.length && !selectorsShareSpecificity(combinedSelectors)) {
    return null;
  }
  const restatedProperties = new Set(
    previousBody.plainDeclarations.map((declaration) => {
      return declaration.property;
    })
  );
  const remainingDeclarations = currentBody.plainDeclarations.filter((declaration) => {
    return !restatedProperties.has(declaration.property);
  });
  const merged = [{ ...previousRule, selectors: combinedSelectors }];
  if (remainingDeclarations.length) {
    merged.push({ ...rule, declarations: remainingDeclarations });
  }
  return merged;
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
    const merged = mergeRuleIntoPredecessor(result[result.length - 1], rule);
    if (merged) {
      result.pop();
      result.push(...merged);
      continue;
    }
    result.push(rule);
  }
  return result;
}

export {
  mergeByDeclarations
};

/**
 * @file Detects and removes rules that produce no CSS output once minified.
 */

/**
 * Determines whether a rule is effectively empty, containing no meaningful
 * CSS output after minification. A rule is effectively empty when it has
 * no declarations, or all of its entries are whitespace, non-important
 * comments, or recursively empty nested rules.
 *
 * @param  {object}  rule  The AST rule node to evaluate.
 * @return {boolean}       True if the rule produces no CSS output.
 */
function isRuleEffectivelyEmpty (rule) {
  if (rule.type !== 'rule') {
    return false;
  }
  const nonWhitespaceEntries = (rule.declarations || []).filter((declaration) => {
    return declaration.type !== 'whitespace';
  });
  if (nonWhitespaceEntries.length === 0) {
    return true;
  }
  return nonWhitespaceEntries.every((entry) => {
    if (entry.type === 'comment') {
      return !entry.comment?.startsWith('!');
    }
    if (entry.type === 'rule') {
      return isRuleEffectivelyEmpty(entry);
    }
    return false;
  });
}

/**
 * Filters out effectively empty rules from the rules array, preventing
 * empty rules from being nested into parent rules during later
 * optimization passes and producing incorrect non-empty output.
 *
 * @param  {Array} rules  The AST rule nodes to filter.
 * @return {Array}        A new array with effectively empty rules removed.
 */
function removeEmptyRules (rules) {
  return rules.filter((rule) => {
    return !isRuleEffectivelyEmpty(rule);
  });
}

export {
  removeEmptyRules
};

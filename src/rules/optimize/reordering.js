/**
 * @file Checks whether moving a rule across another rule preserves property
 * writes in the cascade.
 */

import { expandToOverridableProperties } from './declaration-writes.js';

/**
 * Collects every property written by a list of declarations and nested rules.
 *
 * @param  {Array} entries       The declaration or rule entries to inspect.
 * @param  {Set}   [properties]  The set the properties are added to.
 * @return {Set}                 The expanded properties written by the entries.
 */
function collectWrittenProperties (entries, properties = new Set()) {
  for (const entry of entries || []) {
    if (entry.type === 'declaration' && entry.property) {
      if (entry.property === 'all') {
        properties.add('all');
      } else {
        for (const property of expandToOverridableProperties(entry.property)) {
          properties.add(property);
        }
      }
    }
    collectWrittenProperties(entry.declarations, properties);
    collectWrittenProperties(entry.rules, properties);
  }
  return properties;
}

/**
 * Checks whether two rules write to any of the same properties.
 *
 * @param  {object}  firstRule   The first rule to compare.
 * @param  {object}  secondRule  The second rule to compare.
 * @return {boolean}             Whether the rules write overlapping properties.
 */
function rulesWriteOverlappingProperties (firstRule, secondRule) {
  const firstProperties = collectWrittenProperties(firstRule.declarations);
  const secondProperties = collectWrittenProperties(secondRule.declarations);
  if (
    (firstProperties.has('all') && secondProperties.size > 0) ||
    (secondProperties.has('all') && firstProperties.size > 0)
  ) {
    return true;
  }
  return [...firstProperties].some((property) => {
    return secondProperties.has(property);
  });
}

/**
 * Checks whether moving one entry across another leaves their property writes
 * in the same cascade order.
 *
 * @param  {object}  movingEntry   The entry that would move.
 * @param  {object}  crossedEntry  The entry it would cross.
 * @return {boolean}               Whether the move is safe.
 */
function canMoveRuleAcross (movingEntry, crossedEntry) {
  if (crossedEntry.type === 'comment' || crossedEntry.type === 'whitespace') {
    return true;
  }
  if (movingEntry.type !== 'rule' || crossedEntry.type !== 'rule') {
    return false;
  }
  return !rulesWriteOverlappingProperties(movingEntry, crossedEntry);
}

export {
  canMoveRuleAcross
};

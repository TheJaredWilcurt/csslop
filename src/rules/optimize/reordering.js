/**
 * @file Checks whether moving a rule across its siblings preserves property
 * writes in the cascade.
 */

import { expandToOverridableProperties } from './declaration-writes.js';
import { findLastIndexBefore } from './sorted-indexes.js';

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
 * Builds a lookup that remembers the properties each rule's body writes,
 * including its nested rules. A pass that checks the same rules against many
 * others reuses it so each rule body is only walked once. The rules must not
 * be mutated while the lookup is in use.
 *
 * @return {function(object): Set} Returns the expanded properties a rule writes.
 */
function createWrittenPropertiesCache () {
  const propertiesByRule = new WeakMap();
  return (rule) => {
    let properties = propertiesByRule.get(rule);
    if (!properties) {
      properties = collectWrittenProperties(rule.declarations);
      propertiesByRule.set(rule, properties);
    }
    return properties;
  };
}

/**
 * Indexes which sibling rules write each property, and which siblings can
 * never be crossed at all, so how far a rule can move through its siblings is
 * answered with a few binary searches instead of a comparison against every
 * sibling on the way. Comments and whitespace never block a move, while any
 * entry that is not a rule, such as an at-rule, always does.
 *
 * @param  {Array}                 entries               The sibling AST entries. They must not be mutated or reordered while the index is in use.
 * @param  {function(object): Set} getWrittenProperties  Returns the properties a rule writes.
 * @return {object}                                      The ascending `barrierIndexes`, the `indexesByProperty` map, and the `writingIndexes` of rules that write anything.
 */
function createWriteIndex (entries, getWrittenProperties) {
  const barrierIndexes = [];
  const indexesByProperty = new Map();
  const writingIndexes = [];
  entries.forEach((entry, index) => {
    if (entry.type === 'comment' || entry.type === 'whitespace') {
      return;
    }
    if (entry.type !== 'rule') {
      barrierIndexes.push(index);
      return;
    }
    const properties = getWrittenProperties(entry);
    if (properties.size > 0) {
      writingIndexes.push(index);
    }
    for (const property of properties) {
      let indexes = indexesByProperty.get(property);
      if (!indexes) {
        indexes = [];
        indexesByProperty.set(property, indexes);
      }
      indexes.push(index);
    }
  });
  return {
    barrierIndexes,
    getWrittenProperties,
    indexesByProperty,
    writingIndexes
  };
}

/**
 * Finds the nearest sibling before an index that a rule could not move
 * across. A rule blocks the move when the two write any of the same
 * properties, and an `all` write overlaps any rule that writes something.
 *
 * @param  {object} movingRule   The rule that would move.
 * @param  {object} writeIndex   The index built by `createWriteIndex` for the siblings.
 * @param  {number} beforeIndex  The exclusive end of the range searched backwards.
 * @return {number}              The index of the last blocking sibling before the bound, or -1 when nothing blocks the move.
 */
function findLastBlockingIndex (movingRule, writeIndex, beforeIndex) {
  const { barrierIndexes, getWrittenProperties, indexesByProperty, writingIndexes } = writeIndex;
  const movingProperties = getWrittenProperties(movingRule);
  const lastBarrierIndex = findLastIndexBefore(barrierIndexes, beforeIndex);
  if (movingProperties.size === 0) {
    return lastBarrierIndex;
  }
  if (movingProperties.has('all')) {
    return Math.max(lastBarrierIndex, findLastIndexBefore(writingIndexes, beforeIndex));
  }
  let lastBlockingIndex = Math.max(lastBarrierIndex, findLastIndexBefore(indexesByProperty.get('all'), beforeIndex));
  for (const property of movingProperties) {
    lastBlockingIndex = Math.max(lastBlockingIndex, findLastIndexBefore(indexesByProperty.get(property), beforeIndex));
  }
  return lastBlockingIndex;
}

/**
 * Checks whether a rule can move across every sibling strictly between two
 * indexes, leaving their property writes in the same cascade order.
 *
 * @param  {object}  movingRule   The rule that would move.
 * @param  {object}  writeIndex   The index built by `createWriteIndex` for the siblings.
 * @param  {number}  afterIndex   The exclusive start of the crossed range.
 * @param  {number}  beforeIndex  The exclusive end of the crossed range.
 * @return {boolean}              Whether the move is safe.
 */
function canMoveRuleAcrossRange (movingRule, writeIndex, afterIndex, beforeIndex) {
  if (beforeIndex - afterIndex < 2) {
    return true;
  }
  return findLastBlockingIndex(movingRule, writeIndex, beforeIndex) <= afterIndex;
}

export {
  canMoveRuleAcrossRange,
  createWriteIndex,
  createWrittenPropertiesCache,
  findLastBlockingIndex
};

/**
 * @file Indexes which properties each rule writes to and how strongly, so a merge can ask whether moving declarations past later rules would change the cascade.
 */

import { isCustomProperty } from '../../utilities.js';

import { expandToOverridableProperties } from './declaration-writes.js';
import {
  addSpecificity,
  compareSpecificity,
  maximumRuleSpecificity,
  minimumRuleSpecificity
} from './specificity.js';

/**
 * The property that rewrites every other standard property, and so conflicts
 * with any declaration it is ordered against.
 *
 * @type {string}
 */
const RESET_ALL_PROPERTY = 'all';

/**
 * Index key standing for "declares anything at all", used to order a rule that
 * sets `all` against every other declaration.
 *
 * @type {symbol}
 */
const ANY_PROPERTY = Symbol('any property');

/**
 * @typedef  {object}  RuleWriteProfile
 * @property {Map}     specificityByProperty   The strongest specificity each leaf property is written with.
 * @property {Array}   weakestSpecificity      The weakest specificity the rule's declarations are applied with.
 * @property {Array}   strongestSpecificity    The strongest specificity anything in the rule is written with.
 * @property {boolean} writesStandardProperty  Whether the rule writes any property other than a custom property.
 */

/**
 * Notes in a profile that a leaf property is written with a specificity,
 * keeping only the strongest specificity seen for it.
 *
 * @param {RuleWriteProfile} profile      The profile to extend.
 * @param {string}           property     The leaf property name.
 * @param {Array}            specificity  The specificity the property is written with.
 */
function addWrittenProperty (profile, property, specificity) {
  const strongestSoFar = profile.specificityByProperty.get(property);
  if (!strongestSoFar || compareSpecificity(specificity, strongestSoFar) > 0) {
    profile.specificityByProperty.set(property, specificity);
  }
  if (compareSpecificity(specificity, profile.strongestSpecificity) > 0) {
    profile.strongestSpecificity = specificity;
  }
  profile.writesStandardProperty = profile.writesStandardProperty || !isCustomProperty(property);
}

/**
 * Adds every leaf property a rule's declarations write to into a profile,
 * descending into nested rules, whose declarations only ever match through the
 * parent and so carry the specificity of both selectors.
 *
 * @param {RuleWriteProfile} profile      The profile to extend.
 * @param {object}           rule         The AST rule node to read declarations from.
 * @param {Array}            specificity  The specificity the rule's own declarations apply with.
 */
function addWrittenProperties (profile, rule, specificity) {
  for (const declaration of rule.declarations || []) {
    if (declaration.type === 'rule') {
      const nestedSpecificity = addSpecificity(specificity, maximumRuleSpecificity(declaration.selectors));
      addWrittenProperties(profile, declaration, nestedSpecificity);
    } else if (declaration.type === 'declaration' && declaration.property) {
      for (const leafProperty of expandToOverridableProperties(declaration.property)) {
        addWrittenProperty(profile, leafProperty, specificity);
      }
    }
  }
}

/**
 * Summarizes which properties a rule writes to and how strongly, which is
 * everything the cascade needs to know about a rule to decide whether it may be
 * reordered against another one.
 *
 * @param  {object}           rule  The AST rule node.
 * @return {RuleWriteProfile}       The rule's write profile.
 */
function buildRuleWriteProfile (rule) {
  const profile = {
    specificityByProperty: new Map(),
    weakestSpecificity: minimumRuleSpecificity(rule.selectors),
    strongestSpecificity: [0, 0, 0],
    writesStandardProperty: false
  };
  addWrittenProperties(profile, rule, maximumRuleSpecificity(rule.selectors));
  return profile;
}

/**
 * Folds one rule's writes into another's profile, which is how a profile stays
 * current after a merge appends declarations to a rule. Both rules share the
 * same selectors, so the absorbed writes keep their recorded specificity.
 *
 * @param {RuleWriteProfile} profile         The profile of the rule that grew.
 * @param {RuleWriteProfile} absorbedWrites  The profile of the rule whose declarations were appended.
 */
function absorbWriteProfile (profile, absorbedWrites) {
  for (const [property, specificity] of absorbedWrites.specificityByProperty) {
    addWrittenProperty(profile, property, specificity);
  }
}

/**
 * Tracks which properties each rule writes to and where it sits, so that a
 * merge can ask whether anything after a position could override the
 * declarations it wants to move, instead of rescanning the stylesheet once per
 * merge.
 *
 * Entries for a property are appended in increasing position order, and each
 * new entry discards the earlier ones it dominates, since a declaration that is
 * both later and at least as specific blocks everything a weaker, earlier one
 * would. What remains is a list whose specificity strictly decreases as
 * position grows, so the first entry past a queried position is also the
 * strongest one past it.
 *
 * @param  {Map}    profileByRule  The write profiles already built for rules, shared by every pass of one merge.
 * @return {object}                An index exposing `recordRule` and `blocksRelocation`.
 */
function createOverrideIndex (profileByRule) {
  const entriesByProperty = new Map();

  /**
   * Records that a property is written at a position with a given specificity.
   *
   * @param {string|symbol} property     The leaf property name, or an index key.
   * @param {number}        position     The slot the writing rule occupies.
   * @param {Array}         specificity  The specificity the declaration applies with.
   */
  function addEntry (property, position, specificity) {
    let entries = entriesByProperty.get(property);
    if (!entries) {
      entries = [];
      entriesByProperty.set(property, entries);
    }
    while (entries.length && compareSpecificity(entries[entries.length - 1].specificity, specificity) <= 0) {
      entries.pop();
    }
    entries.push({ position, specificity });
  }

  /**
   * Whether some rule after a position writes to a property with at least a
   * given specificity, and could therefore win the cascade against it.
   *
   * @param  {string|symbol} property     The leaf property name, or an index key.
   * @param  {number}        position     The position to search after.
   * @param  {Array}         specificity  The specificity to compare against.
   * @return {boolean}                    True when a later rule could override the property.
   */
  function hasStrongerEntryAfter (property, position, specificity) {
    const entries = entriesByProperty.get(property);
    if (!entries) {
      return false;
    }
    let low = 0;
    let high = entries.length;
    while (low < high) {
      const middle = Math.floor((low + high) / 2);
      if (entries[middle].position > position) {
        high = middle;
      } else {
        low = middle + 1;
      }
    }
    if (low === entries.length) {
      return false;
    }
    return compareSpecificity(entries[low].specificity, specificity) >= 0;
  }

  /**
   * Returns a rule's write profile, building it the first time it is needed.
   * Rules only ever grow here, by absorbing another rule's declarations, and
   * `absorbRule` folds those into the profile, so a profile stays valid for
   * every pass of the merge.
   *
   * @param  {object}           rule  The AST rule node.
   * @return {RuleWriteProfile}       The rule's write profile.
   */
  function getWriteProfile (rule) {
    let profile = profileByRule.get(rule);
    if (!profile) {
      profile = buildRuleWriteProfile(rule);
      profileByRule.set(rule, profile);
    }
    return profile;
  }

  /**
   * Records every property a rule writes to at the position it occupies.
   *
   * @param {object} rule      The AST rule node.
   * @param {number} position  The slot the rule occupies.
   */
  function recordRule (rule, position) {
    const profile = getWriteProfile(rule);
    if (!profile.specificityByProperty.size) {
      return;
    }
    for (const [property, specificity] of profile.specificityByProperty) {
      addEntry(property, position, specificity);
    }
    addEntry(ANY_PROPERTY, position, profile.strongestSpecificity);
  }

  /**
   * Folds a rule's writes into the rule that just absorbed its declarations, so
   * the grown rule is treated as writing to both sets of properties.
   *
   * @param {object} rule          The rule that grew.
   * @param {object} absorbedRule  The rule whose declarations were appended to it.
   */
  function absorbRule (rule, absorbedRule) {
    absorbWriteProfile(getWriteProfile(rule), getWriteProfile(absorbedRule));
  }

  /**
   * Whether moving a rule's declarations past everything recorded after a
   * position would change which declaration wins the cascade. Only a rule that
   * is strictly less specific is guaranteed to lose either way, so anything of
   * equal or greater specificity that writes to the same properties blocks the
   * move.
   *
   * @param  {object}  movingRule     The rule whose declarations would relocate.
   * @param  {number}  afterPosition  The position the declarations would move across.
   * @return {boolean}                True when the relocation is unsafe.
   */
  function blocksRelocation (movingRule, afterPosition) {
    const profile = getWriteProfile(movingRule);
    const specificity = profile.weakestSpecificity;
    for (const property of profile.specificityByProperty.keys()) {
      if (hasStrongerEntryAfter(property, afterPosition, specificity)) {
        return true;
      }
    }
    if (profile.writesStandardProperty && hasStrongerEntryAfter(RESET_ALL_PROPERTY, afterPosition, specificity)) {
      return true;
    }
    return (
      profile.specificityByProperty.has(RESET_ALL_PROPERTY) &&
      hasStrongerEntryAfter(ANY_PROPERTY, afterPosition, specificity)
    );
  }

  return {
    absorbRule,
    blocksRelocation,
    recordRule
  };
}

export {
  createOverrideIndex
};

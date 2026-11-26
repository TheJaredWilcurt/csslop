/**
 * @file Describes what a declaration writes to: whether it declares a property at all, which leaf properties it can override, and whether it is flagged important.
 */

import {
  expandToLeafProperties,
  getOverridesOf
} from '../../declarations/config.js';

/**
 * The leaf properties each declared property can write to, computed on first
 * use. The shorthand tables never change, so a property always expands the same
 * way.
 *
 * @type {Map<string, Set<string>>}
 */
const overridablePropertiesByProperty = new Map();

/**
 * Expands a declared property into every leaf longhand it can write to,
 * including the extras a shorthand resets beyond its own longhands. Two
 * declarations can only override one another when these sets intersect, which
 * is what makes `margin` conflict with `margin-top` but not with `color`.
 *
 * @param  {string} property  The declared property name.
 * @return {Set}              The leaf property names the declaration writes to.
 */
function expandToOverridableProperties (property) {
  const cachedProperties = overridablePropertiesByProperty.get(property);
  if (cachedProperties) {
    return cachedProperties;
  }
  const overridableProperties = new Set(expandToLeafProperties(property));
  for (const resetProperty of getOverridesOf(property)) {
    for (const leafProperty of expandToLeafProperties(resetProperty)) {
      overridableProperties.add(leafProperty);
    }
  }
  overridablePropertiesByProperty.set(property, overridableProperties);
  return overridableProperties;
}

/**
 * Reports whether an entry of a rule's body is a declaration whose standing in
 * the cascade can be read off the property it writes. Anything else a body may
 * hold, such as a nested rule, is never shadowed by a declaration beside it.
 *
 * @param  {object}  entry  An entry of a rule's declaration list.
 * @return {boolean}        True when the entry is a property declaration.
 */
function isPropertyDeclaration (entry) {
  return entry.type === 'declaration' && Boolean(entry.property);
}

/**
 * Determines whether a declaration carries a trailing `!important` flag.
 *
 * @param  {object}  declaration  The AST declaration node.
 * @return {boolean}              True when the declaration is important.
 */
function isImportantDeclaration (declaration) {
  // A trailing !important suffix on the raw declaration value
  return /!\s*important\s*$/i.test(declaration.rawValue || declaration.value || '');
}

/**
 * Collects every leaf property written by a list of AST entries, including the
 * declarations of nested rules and blocks.
 *
 * @param  {Array} entries              The AST entries to search.
 * @param  {Set}   [writtenProperties]  The set the names are added to.
 * @return {Set}                        The leaf property names written anywhere within the entries.
 */
function collectWrittenLeafProperties (entries, writtenProperties = new Set()) {
  for (const entry of entries) {
    if (isPropertyDeclaration(entry)) {
      for (const leafProperty of expandToOverridableProperties(entry.property)) {
        writtenProperties.add(leafProperty);
      }
    }
    if (entry.declarations) {
      collectWrittenLeafProperties(entry.declarations, writtenProperties);
    }
    if (entry.rules) {
      collectWrittenLeafProperties(entry.rules, writtenProperties);
    }
  }
  return writtenProperties;
}

/**
 * Reports whether two sets of written leaf properties share a property. Only a
 * shared property can make the order of two groups of rules change the cascade.
 * `all` resets every property, so it shares one with any property at all.
 *
 * @param  {Set}     firstProperties   The leaf properties written by the first group.
 * @param  {Set}     secondProperties  The leaf properties written by the second group.
 * @return {boolean}                   True when the two groups write a property in common.
 */
function propertySetsOverlap (firstProperties, secondProperties) {
  if (firstProperties.has('all') || secondProperties.has('all')) {
    return firstProperties.size > 0 && secondProperties.size > 0;
  }
  return [...firstProperties].some((property) => {
    return secondProperties.has(property);
  });
}

export {
  collectWrittenLeafProperties,
  expandToOverridableProperties,
  isImportantDeclaration,
  isPropertyDeclaration,
  propertySetsOverlap
};

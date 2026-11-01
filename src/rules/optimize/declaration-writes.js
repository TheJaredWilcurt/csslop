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

export {
  expandToOverridableProperties,
  isImportantDeclaration,
  isPropertyDeclaration
};

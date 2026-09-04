/**
 * @file Builds keyed lookups and normalized views over a rule's declarations,
 * so the shorthand passes can ask which properties a rule sets, and what each
 * of them minifies to, without rescanning its declarations once per property
 * they are interested in.
 */

import { minifyValue } from '../value/minify.js';

/**
 * @typedef  {object}  DeclarationDescription
 * @property {object}  declaration             The original declaration object.
 * @property {number}  index                   The declaration's index within the rule.
 * @property {string}  property                The declared property name.
 * @property {string}  text                    The minified `property:value` text.
 * @property {string}  value                   The minified value, without any `!important`.
 * @property {boolean} isImportant             Whether the declaration carries `!important`.
 */

/**
 * Describes a declaration through its minified value, which is the form the
 * shorthand passes compare, rewrite, and measure the output length of.
 *
 * @param  {object}                 declaration  The CSS declaration object.
 * @param  {number}                 index        The declaration's index within the rule.
 * @return {DeclarationDescription}              The normalized view of the declaration.
 */
function describeDeclaration (declaration, index) {
  const minifiedValue = minifyValue(declaration);
  return {
    declaration,
    index,
    property: declaration.property,
    text: declaration.property + ':' + minifiedValue,
    value: minifiedValue.replace('!important', '').trim(),
    isImportant: minifiedValue.includes('!important')
  };
}

/**
 * Indexes the first declaration of each property. The first occurrence is the
 * one a linear search would return, so this stands in for repeated scans that
 * look a property's declaration up by name.
 *
 * @param  {Array} declarations  The declarations of a single rule, in source order.
 * @return {Map}                 Map of property name to its first declaration.
 */
function indexFirstDeclarationByProperty (declarations) {
  const declarationByProperty = new Map();
  for (const declaration of declarations) {
    if (declaration.property && !declarationByProperty.has(declaration.property)) {
      declarationByProperty.set(declaration.property, declaration);
    }
  }
  return declarationByProperty;
}

/**
 * Collects the names of every property a rule declares.
 *
 * @param  {Array} declarations  The declarations of a single rule.
 * @return {Set}                 The declared property names.
 */
function collectDeclaredProperties (declarations) {
  const declaredProperties = new Set();
  for (const declaration of declarations) {
    if (declaration.property) {
      declaredProperties.add(declaration.property);
    }
  }
  return declaredProperties;
}

export {
  collectDeclaredProperties,
  describeDeclaration,
  indexFirstDeclarationByProperty
};

/**
 * @file Builds keyed lookups over a rule's declarations, so the shorthand
 * passes can ask which properties a rule sets without rescanning its
 * declarations once per property they are interested in.
 */

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
  indexFirstDeclarationByProperty
};

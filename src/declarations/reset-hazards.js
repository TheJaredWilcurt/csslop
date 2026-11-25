/**
 * @file Tracks the properties a shorthand would reset without being given a value, so that assembling a shorthand out of longhands never cancels a value another rule of the stylesheet set.
 */

import {
  expandToLeafProperties,
  getOverridesOf
} from './config.js';

/**
 * Collects the rules nested inside a rule. The parser stores the children of an
 * at-rule as a list of rules, and the children of a style rule that uses CSS
 * nesting as declarations that carry rules of their own.
 *
 * @param  {object} rule  The AST rule node to look inside.
 * @return {Array}        The rule nodes nested within it.
 */
function collectNestedRules (rule) {
  const nestedRules = [...(rule.rules || [])];
  for (const declaration of rule.declarations || []) {
    if (declaration.rules || declaration.declarations) {
      nestedRules.push(declaration);
    }
  }
  return nestedRules;
}

/**
 * Adds a property to a set, along with every leaf longhand it sets, so that a
 * later check finds the property whichever of the two spellings it is asked about.
 *
 * @param {Set}    propertySet  The set the names are added to.
 * @param {string} property     The declared property name.
 */
function addPropertyAndLeaves (propertySet, property) {
  propertySet.add(property);
  for (const leafProperty of expandToLeafProperties(property)) {
    propertySet.add(leafProperty);
  }
}

/**
 * Records which properties the stylesheet declares, in any rule at any nesting
 * depth, so that each rule can later ask whether assembling a shorthand would
 * cancel a value another rule set.
 *
 * @param {Array}  rules    The AST rule nodes of the whole stylesheet.
 * @param {object} context  The minification context to populate.
 */
function recordStylesheetDeclaredProperties (rules, context) {
  const pendingRules = [...rules];
  while (pendingRules.length) {
    const rule = pendingRules.pop();
    for (const declaration of rule.declarations || []) {
      if (declaration.property) {
        addPropertyAndLeaves(context.stylesheetDeclaredProperties, declaration.property);
      }
    }
    pendingRules.push(...collectNestedRules(rule));
  }
}

/**
 * Collects every property a rule states, whether it declares the property
 * itself or a shorthand that sets it, along with each leaf longhand that
 * declaration sets.
 *
 * @param  {Set} declaredProperties  The property names the rule declares.
 * @return {Set}                     The property names and leaf longhands the rule states.
 */
function collectStatedProperties (declaredProperties) {
  const statedProperties = new Set();
  for (const property of declaredProperties) {
    addPropertyAndLeaves(statedProperties, property);
  }
  return statedProperties;
}

/**
 * Checks whether assembling a shorthand out of longhands would reset a property
 * that the stylesheet sets somewhere else. The `border` shorthand resets
 * `border-image`, so turning the border longhands of one rule into `border`
 * cancels the `border-image` that another rule sets on the same element. The
 * same holds for a `font` built without a `font-weight` that another rule sets,
 * since the shorthand writes every longhand it omits back to its initial value.
 * A rule that states the reset property itself is safe, because that
 * declaration is emitted after the shorthand and restates the value the
 * shorthand discarded.
 *
 * @param  {string}  shorthandName       The shorthand that would be assembled.
 * @param  {Set}     declaredProperties  The property names the rule declares.
 * @param  {object}  context             The minification context with the stylesheet's declared properties.
 * @return {boolean}                     Whether assembling the shorthand would discard another rule's value.
 */
function resetsPropertyDeclaredElsewhere (shorthandName, declaredProperties, context) {
  const stylesheetDeclaredProperties = context?.stylesheetDeclaredProperties;
  if (!stylesheetDeclaredProperties?.size) {
    return false;
  }
  const statedProperties = collectStatedProperties(declaredProperties);
  const omittedLeaves = [...expandToLeafProperties(shorthandName)].filter((leafProperty) => {
    return !statedProperties.has(leafProperty);
  });
  return [...getOverridesOf(shorthandName), ...omittedLeaves].some((resetProperty) => {
    return stylesheetDeclaredProperties.has(resetProperty) && !statedProperties.has(resetProperty);
  });
}

export {
  recordStylesheetDeclaredProperties,
  resetsPropertyDeclaredElsewhere
};

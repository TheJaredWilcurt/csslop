/**
 * @file Tracks the properties a shorthand resets without being able to express them, so that assembling a shorthand out of longhands never cancels a value another rule of the stylesheet set.
 */

import {
  getOverridesOf,
  shorthandOverrideMap
} from './config.js';

/**
 * Collects every property that some shorthand resets without being able to
 * express it, such as `border-image` for `border`. Only these properties can
 * lose their value to a newly assembled shorthand, so only these are worth
 * tracking across the stylesheet.
 *
 * @return {Set} The property names a shorthand resets but cannot express.
 */
function collectResettableProperties () {
  const resettableProperties = new Set();
  for (const resetProperties of Object.values(shorthandOverrideMap)) {
    for (const property of resetProperties) {
      resettableProperties.add(property);
    }
  }
  return resettableProperties;
}

/**
 * The properties a shorthand resets but cannot express. The shorthand tables
 * never change, so the set is built once.
 *
 * @type {Set<string>}
 */
const RESETTABLE_PROPERTIES = collectResettableProperties();

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
 * Records which resettable properties the stylesheet declares, in any rule at
 * any nesting depth, so that each rule can later ask whether assembling a
 * shorthand would cancel a value another rule set.
 *
 * @param {Array}  rules    The AST rule nodes of the whole stylesheet.
 * @param {object} context  The minification context to populate.
 */
function recordStylesheetResetProperties (rules, context) {
  const pendingRules = [...rules];
  while (pendingRules.length) {
    const rule = pendingRules.pop();
    for (const declaration of rule.declarations || []) {
      if (RESETTABLE_PROPERTIES.has(declaration.property)) {
        context.stylesheetResetProperties.add(declaration.property);
      }
    }
    pendingRules.push(...collectNestedRules(rule));
  }
}

/**
 * Checks whether assembling a shorthand out of longhands would reset a property
 * that the stylesheet sets somewhere else. The `border` shorthand resets
 * `border-image`, so turning the border longhands of one rule into `border`
 * cancels the `border-image` that another rule sets on the same element. A rule
 * that states the reset property itself is safe, because that declaration is
 * emitted after the shorthand and restates the value the shorthand discarded.
 *
 * @param  {string}  shorthandName       The shorthand that would be assembled.
 * @param  {Set}     declaredProperties  The property names the rule declares.
 * @param  {object}  context             The minification context with the stylesheet's reset properties.
 * @return {boolean}                     Whether assembling the shorthand would discard another rule's value.
 */
function resetsPropertyDeclaredElsewhere (shorthandName, declaredProperties, context) {
  const stylesheetResetProperties = context?.stylesheetResetProperties;
  if (!stylesheetResetProperties?.size) {
    return false;
  }
  for (const resetProperty of getOverridesOf(shorthandName)) {
    const isSetElsewhere = (
      stylesheetResetProperties.has(resetProperty) &&
      !declaredProperties.has(resetProperty)
    );
    if (isSetElsewhere) {
      return true;
    }
  }
  return false;
}

export {
  recordStylesheetResetProperties,
  resetsPropertyDeclaredElsewhere
};

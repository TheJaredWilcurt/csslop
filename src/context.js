/**
 * @file Manages the shared minification context for tracking registered custom properties and their syntax.
 */

/**
 * Creates a fresh minification context used to track `@property`-registered custom properties and their declared syntax types across the entire stylesheet.
 *
 * @return {object} A context object with a registeredCustomProperties Set and a registeredCustomPropertySyntax Map.
 */
function createMinifyContext () {
  return {
    registeredCustomProperties: new Set(),
    registeredCustomPropertySyntax: new Map()
  };
}

export { createMinifyContext };

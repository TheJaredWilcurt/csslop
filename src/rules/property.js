/**
 * @file Analyzes `@property` at-rules, resolving each descriptor against the value the CSS engine assumes when the descriptor is absent, so redundant descriptors and pointless registrations can be dropped.
 */

/**
 * The descriptors an `@property` rule can declare. Anything else inside the
 * rule is an unknown descriptor, which the CSS engine discards while parsing.
 *
 * @type {Set<string>}
 */
const PROPERTY_DESCRIPTORS = new Set([
  'syntax',
  'inherits',
  'initial-value'
]);

/**
 * The syntax that accepts any token sequence. It is also the syntax a
 * registration falls back to when the rule omits the `syntax` descriptor.
 *
 * @type {string}
 */
const UNIVERSAL_SYNTAX = '*';

/**
 * The inheritance a registration falls back to when the rule omits the
 * `inherits` descriptor.
 *
 * @type {string}
 */
const DEFAULT_INHERITS = 'true';

/**
 * Reads a descriptor value the way the CSS engine compares it, ignoring the
 * whitespace that surrounds the value.
 *
 * @param  {object} declaration  The descriptor declaration node.
 * @return {string}              The descriptor value without surrounding whitespace.
 */
function readDescriptorValue (declaration) {
  return String(declaration.value ?? '').trim();
}

/**
 * Reads a `syntax` descriptor as the syntax it describes, rather than as the
 * string it is written as, so it can be compared against the universal syntax.
 *
 * @param  {string} syntaxValue  The raw `syntax` descriptor value, such as `"<length>"`.
 * @return {string}              The described syntax, such as `<length>`.
 */
function unquoteSyntax (syntaxValue) {
  // A value wrapped in a matching pair of quotes, capturing the string contents
  const quotedStringPattern = /^(["'])([\s\S]*)\1$/;
  const quotedString = syntaxValue.match(quotedStringPattern);
  if (quotedString) {
    return quotedString[2].trim();
  }
  return syntaxValue;
}

/**
 * Collects the descriptors an `@property` rule declares, keyed by descriptor
 * name and ordered by first appearance. Unknown descriptors are left out
 * because the CSS engine ignores them, and a descriptor declared more than
 * once resolves to its final declaration, which is the one the engine keeps.
 *
 * @param  {object} rule  The `@property` AST rule node.
 * @return {Map}          Descriptor names mapped to the declaration that wins.
 */
function collectPropertyDescriptors (rule) {
  const descriptors = new Map();
  for (const declaration of rule.declarations || []) {
    const descriptorName = String(declaration.property ?? '').toLowerCase();
    const isKnownDescriptor = (
      declaration.type === 'declaration' &&
      PROPERTY_DESCRIPTORS.has(descriptorName)
    );
    if (isKnownDescriptor) {
      descriptors.set(descriptorName, declaration);
    }
  }
  return descriptors;
}

/**
 * Resolves the syntax a set of descriptors registers, falling back to the
 * universal syntax when the `syntax` descriptor is absent.
 *
 * @param  {Map}    descriptors  Descriptor names mapped to their declarations.
 * @return {string}              The registered syntax.
 */
function resolveRegisteredSyntax (descriptors) {
  const syntaxDeclaration = descriptors.get('syntax');
  if (!syntaxDeclaration) {
    return UNIVERSAL_SYNTAX;
  }
  return unquoteSyntax(readDescriptorValue(syntaxDeclaration));
}

/**
 * Reports whether the CSS engine accepts the registration a set of descriptors
 * describes. Registering anything narrower than the universal syntax requires
 * an `initial-value`, since the engine has no valid value to start from
 * otherwise, and a registration it rejects has no effect on the stylesheet.
 *
 * @param  {Map}     descriptors  Descriptor names mapped to their declarations.
 * @return {boolean}              True when the registration is valid.
 */
function isValidRegistration (descriptors) {
  if (resolveRegisteredSyntax(descriptors) === UNIVERSAL_SYNTAX) {
    return true;
  }
  return descriptors.has('initial-value');
}

/**
 * Reports whether a descriptor declares exactly what the CSS engine already
 * assumes, which makes writing the descriptor out pointless. An
 * `initial-value` always says something, because the value it defaults to is
 * the guaranteed-invalid value, which no declaration can spell out.
 *
 * @param  {string}  descriptorName  The lowercased descriptor name.
 * @param  {object}  declaration     The descriptor declaration node.
 * @return {boolean}                 True when the descriptor restates a default.
 */
function isDefaultDescriptor (descriptorName, declaration) {
  const value = readDescriptorValue(declaration);
  if (descriptorName === 'syntax') {
    return unquoteSyntax(value) === UNIVERSAL_SYNTAX;
  }
  if (descriptorName === 'inherits') {
    return value.toLowerCase() === DEFAULT_INHERITS;
  }
  return false;
}

/**
 * Reduces an `@property` rule to the descriptors worth writing out, meaning
 * the ones that describe something other than what the CSS engine assumes on
 * its own. An empty result means the entire rule can be dropped, either
 * because the engine rejects the registration or because the registration
 * matches an unregistered custom property in every way.
 *
 * @param  {object} rule  The `@property` AST rule node.
 * @return {Array}        The descriptor declarations to render.
 */
function resolvePropertyDescriptors (rule) {
  const descriptors = collectPropertyDescriptors(rule);
  if (!isValidRegistration(descriptors)) {
    return [];
  }
  const meaningfulDescriptors = [];
  for (const [descriptorName, declaration] of descriptors) {
    if (!isDefaultDescriptor(descriptorName, declaration)) {
      meaningfulDescriptors.push(declaration);
    }
  }
  return meaningfulDescriptors;
}

/**
 * Reports whether an `@property` rule survives minification, which is also
 * what decides whether the rest of the stylesheet may rely on the custom
 * property being registered. Rules that describe nothing beyond the defaults
 * leave the custom property just as unregistered as never mentioning it.
 *
 * @param  {object}  rule  The `@property` AST rule node.
 * @return {boolean}       True when the rule registers the custom property.
 */
function registersCustomProperty (rule) {
  return resolvePropertyDescriptors(rule).length > 0;
}

export {
  registersCustomProperty,
  resolvePropertyDescriptors
};

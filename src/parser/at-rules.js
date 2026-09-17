/**
 * @file Describes every at-rule the parser knows by name, so the parser can read one the same way no matter which at-rule it is.
 */

/**
 * The ways an at-rule's body can be written, which is what decides how the
 * parser reads whatever follows the at-rule's prelude.
 *
 * `nestedRules` is a block that holds rules, nested at-rules, or the
 * declarations of a nesting parent. `declarations` is a block that only
 * describes something, such as a font or a custom property, so it holds
 * declarations alone. `statement` has no block at all and ends at a
 * semicolon. `keyframes` and `page` each hold a kind of child that exists
 * nowhere else in CSS, so the parser reads their bodies itself.
 */
const AT_RULE_BODY = {
  declarations: 'declarations',
  keyframes: 'keyframes',
  nestedRules: 'nested-rules',
  page: 'page',
  statement: 'statement'
};

/**
 * Matches the condition of an at-rule that is written with spaces in front of
 * it and ends where the at-rule's block begins.
 *
 * @type {RegExp}
 */
// Spaces, then everything up to the opening brace of the block
const CONDITION_PATTERN = / *([^{]+)/y;

/**
 * Matches the condition of an at-rule whose condition may be left out
 * entirely, such as a `@scope` that only limits its lower boundary.
 *
 * @type {RegExp}
 */
// Leading whitespace, then everything (possibly nothing) up to the opening brace
const OPTIONAL_CONDITION_PATTERN = /\s*([^{]*)/y;

/**
 * Matches the condition of an at-rule that has to be separated from its name
 * by whitespace, because the condition begins with an identifier rather than
 * with punctuation.
 *
 * @type {RegExp}
 */
// Required whitespace, then everything up to the opening brace of the block
const REQUIRED_CONDITION_PATTERN = /\s+([^{]+)/y;

/**
 * Matches the names a `@layer` block or statement declares. An at-sign ends
 * the list because a layer name cannot contain one, so an unterminated
 * `@layer` gives way to the at-rule that follows it.
 *
 * @type {RegExp}
 */
// Spaces, then the layer names, which stop at a block, a semicolon, or another at-rule
const LAYER_NAMES_PATTERN = / *([^{;@]+)/y;

/**
 * Matches the dashed identifier that names a `@property` or a
 * `@position-try`.
 *
 * @type {RegExp}
 */
// Whitespace, the dashed identifier, then the whitespace before the block
const DASHED_NAME_PATTERN = /\s+(--[-\w]+)\s*/y;

/**
 * Matches the identifier that names a `@counter-style` or a `@keyframes`.
 *
 * @type {RegExp}
 */
// Whitespace, the identifier, then the whitespace before the block
const IDENTIFIER_NAME_PATTERN = /\s*([-\w]+)\s*/y;

/**
 * Matches nothing but the whitespace between an at-rule that has no prelude
 * and the block that follows it.
 *
 * @type {RegExp}
 */
// The whitespace, if any, in front of the block
const NO_PRELUDE_PATTERN = /\s*/y;

/**
 * Every at-rule that is named exactly, mapped to the node it produces and the
 * way its prelude and body are written. At-rules whose name carries a vendor
 * prefix, and the margin boxes of `@page`, are matched separately.
 *
 * @type {object}
 */
const AT_RULE_DEFINITIONS = {
  charset: {
    type: 'charset',
    body: AT_RULE_BODY.statement,
    preludeFields: ['charset']
  },
  container: {
    type: 'container',
    body: AT_RULE_BODY.nestedRules,
    preludePattern: CONDITION_PATTERN,
    preludeFields: ['container']
  },
  'counter-style': {
    type: 'counter-style',
    body: AT_RULE_BODY.declarations,
    preludePattern: IDENTIFIER_NAME_PATTERN,
    preludeFields: ['name']
  },
  'custom-media': {
    type: 'custom-media',
    body: AT_RULE_BODY.statement,
    preludeFields: ['name', 'media']
  },
  'font-face': {
    type: 'font-face',
    body: AT_RULE_BODY.declarations,
    preludePattern: NO_PRELUDE_PATTERN,
    preludeFields: []
  },
  'font-feature-values': {
    type: 'font-feature-values',
    body: AT_RULE_BODY.nestedRules,
    preludePattern: REQUIRED_CONDITION_PATTERN,
    preludeFields: ['fontFamily']
  },
  host: {
    type: 'host',
    body: AT_RULE_BODY.nestedRules,
    preludePattern: NO_PRELUDE_PATTERN,
    preludeFields: []
  },
  import: {
    type: 'import',
    body: AT_RULE_BODY.statement,
    preludeFields: ['import']
  },
  layer: {
    type: 'layer',
    body: AT_RULE_BODY.nestedRules,
    preludePattern: LAYER_NAMES_PATTERN,
    preludeFields: ['layer'],
    statementFallback: true
  },
  media: {
    type: 'media',
    body: AT_RULE_BODY.nestedRules,
    preludePattern: CONDITION_PATTERN,
    preludeFields: ['media']
  },
  namespace: {
    type: 'namespace',
    body: AT_RULE_BODY.statement,
    preludeFields: ['namespace']
  },
  page: {
    type: 'page',
    body: AT_RULE_BODY.page,
    preludePattern: NO_PRELUDE_PATTERN,
    preludeFields: []
  },
  'position-try': {
    type: 'position-try',
    body: AT_RULE_BODY.declarations,
    preludePattern: DASHED_NAME_PATTERN,
    preludeFields: ['name']
  },
  property: {
    type: 'property',
    body: AT_RULE_BODY.declarations,
    preludePattern: DASHED_NAME_PATTERN,
    preludeFields: ['name']
  },
  scope: {
    type: 'scope',
    body: AT_RULE_BODY.nestedRules,
    preludePattern: OPTIONAL_CONDITION_PATTERN,
    preludeFields: ['scope']
  },
  'starting-style': {
    type: 'starting-style',
    body: AT_RULE_BODY.nestedRules,
    preludePattern: NO_PRELUDE_PATTERN,
    preludeFields: []
  },
  supports: {
    type: 'supports',
    body: AT_RULE_BODY.nestedRules,
    preludePattern: CONDITION_PATTERN,
    preludeFields: ['supports']
  },
  'view-transition': {
    type: 'view-transition',
    body: AT_RULE_BODY.declarations,
    preludePattern: NO_PRELUDE_PATTERN,
    preludeFields: []
  }
};

/**
 * The at-rules whose name may carry a vendor prefix, such as
 * `@-webkit-keyframes`. The prefix is reported separately from the node's
 * other fields so that it can be written back out.
 *
 * @type {object}
 */
const VENDOR_PREFIXED_AT_RULES = {
  document: {
    type: 'document',
    body: AT_RULE_BODY.nestedRules,
    preludePattern: CONDITION_PATTERN,
    preludeFields: ['document']
  },
  keyframes: {
    type: 'keyframes',
    body: AT_RULE_BODY.keyframes,
    preludePattern: IDENTIFIER_NAME_PATTERN,
    preludeFields: ['name']
  }
};

/**
 * The margin boxes a `@page` rule may contain, each of which is written as an
 * at-rule holding declarations.
 *
 * @type {Set<string>}
 */
const PAGE_MARGIN_BOX_NAMES = new Set([
  'top-left-corner',
  'top-left',
  'top-center',
  'top-right',
  'top-right-corner',
  'bottom-left-corner',
  'bottom-left',
  'bottom-center',
  'bottom-right',
  'bottom-right-corner',
  'left-top',
  'left-middle',
  'left-bottom',
  'right-top',
  'right-middle',
  'right-bottom'
]);

/**
 * The definition shared by every margin box of a `@page` rule, whose own name
 * is the only thing that tells them apart.
 *
 * @type {object}
 */
const PAGE_MARGIN_BOX_DEFINITION = {
  type: 'page-margin-box',
  body: AT_RULE_BODY.declarations,
  preludePattern: NO_PRELUDE_PATTERN,
  preludeFields: []
};

/**
 * Finds how an at-rule of a given name is written, including the vendor
 * prefix when the name carries one. An unknown name has no definition, and is
 * read as a generic at-rule instead.
 *
 * @param  {string}      name  The at-rule's name, without its at-sign.
 * @return {object|null}       The definition of the at-rule, or null when the name is unknown.
 */
function findAtRuleDefinition (name) {
  const definition = AT_RULE_DEFINITIONS[name];
  if (definition) {
    return definition;
  }
  if (PAGE_MARGIN_BOX_NAMES.has(name)) {
    return { ...PAGE_MARGIN_BOX_DEFINITION, name };
  }
  for (const baseName in VENDOR_PREFIXED_AT_RULES) {
    if (name.endsWith(baseName)) {
      const vendor = name.slice(0, name.length - baseName.length);
      return { ...VENDOR_PREFIXED_AT_RULES[baseName], vendor };
    }
  }
  return null;
}

export {
  AT_RULE_BODY,
  findAtRuleDefinition
};

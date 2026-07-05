/**
 * @file Converts parsed CSS AST rule nodes into minified CSS strings, handling all CSS at-rule types, selectors, declarations, and nesting.
 */

import { processDeclarations } from '../declarations/process.js';
import { minifyValue } from '../value/minify.js';

import {
  canUnwrapSupports,
  normalizeMedia,
  normalizeSupports,
  unescapeIdent,
  unescapeSelector
} from './normalize.js';

/**
 * Renders an array of CSS declaration objects as a minified semicolon-separated string, filtering out whitespace entries.
 *
 * @param  {Array}  declarations  The declaration objects to render.
 * @return {string}               A semicolon-joined "property:value" string.
 */
function stringifyDeclarations (declarations) {
  return declarations
    .filter((declaration) => {
      return declaration.type !== 'whitespace';
    })
    .map((declaration) => {
      return [declaration.property, ':', minifyValue(declaration)].join('');
    })
    .join(';');
}

/**
 * Recursively stringifies child rules into a concatenated minified CSS string.
 *
 * @param  {Array}  rules    The child AST rule nodes to stringify.
 * @param  {object} context  The minification context.
 * @return {string}          The concatenated minified CSS for all child rules.
 */
function stringifyChildRules (rules, context) {
  return (rules || []).map((childRule) => {
    return stringifyRule(childRule, context);
  }).join('');
}

/**
 * Splits a parameter string by commas while respecting nested parentheses,
 * so commas inside function calls within default values are not treated as separators.
 *
 * @param  {string} parameterString  The comma-separated parameter string to split.
 * @return {Array}                   An array of individual parameter strings.
 */
function splitParametersByComma (parameterString) {
  const parameters = [];
  let currentParameter = '';
  let parenthesisDepth = 0;
  for (const character of parameterString) {
    if (character === '(') {
      parenthesisDepth++;
    } else if (character === ')') {
      parenthesisDepth--;
    }
    if (character === ',' && parenthesisDepth === 0) {
      parameters.push(currentParameter);
      currentParameter = '';
    } else {
      currentParameter += character;
    }
  }
  parameters.push(currentParameter);
  return parameters;
}

/**
 * Minifies a `@function` prelude (signature) by collapsing whitespace around
 * parameter separators (commas) and default value delimiters (colons).
 *
 * @param  {string} prelude  The raw `@function` prelude string (e.g. "--tint(--color, --amount: 10%)").
 * @return {string}          The minified prelude (e.g. "--tint(--color,--amount:10%)").
 */
function minifyFunctionPrelude (prelude) {
  const trimmedPrelude = prelude.trim();
  const openParenIndex = trimmedPrelude.indexOf('(');
  if (openParenIndex === -1) {
    return trimmedPrelude;
  }
  const functionName = trimmedPrelude.slice(0, openParenIndex);
  const closeParenIndex = trimmedPrelude.lastIndexOf(')');
  const innerContent = trimmedPrelude.slice(openParenIndex + 1, closeParenIndex);
  const parameters = splitParametersByComma(innerContent);
  const minifiedParameters = parameters.map((parameter) => {
    // Collapse whitespace around the colon separating parameter name from default value
    return parameter.trim().replace(/\s*:\s*/, ':');
  });
  return functionName + '(' + minifiedParameters.join(',') + ')';
}

/**
 * Stringifies a generic `at-rule` AST node into minified CSS, with specialized
 * prelude minification for `@function` rules and generic whitespace handling
 * for other unknown at-rules.
 *
 * @param  {object} rule     The AST at-rule node with name, prelude, and rules.
 * @param  {object} context  The minification context.
 * @return {string}          The minified at-rule CSS string, or empty string if body is empty.
 */
function stringifyAtRule (rule, context) {
  let minifiedPrelude;
  if (rule.name === 'function') {
    minifiedPrelude = minifyFunctionPrelude(rule.prelude || '');
  } else {
    // Collapse runs of whitespace to a single space for generic at-rules
    minifiedPrelude = (rule.prelude || '').trim().replace(/\s+/g, ' ');
  }

  const bodyItems = (rule.rules || []).filter((item) => {
    return item.type !== 'whitespace';
  });
  if (bodyItems.length === 0) {
    return '';
  }

  const declarations = bodyItems.filter((item) => {
    return item.type === 'declaration' && item.property;
  });
  const nestedRules = bodyItems.filter((item) => {
    return item.type !== 'declaration';
  });

  const renderedDeclarations = stringifyDeclarations(declarations);
  const renderedNestedRules = stringifyChildRules(nestedRules, context);
  const body = [renderedDeclarations, renderedNestedRules].filter(Boolean).join('');
  if (!body) {
    return '';
  }

  const separator = minifiedPrelude ? ' ' : '';
  return '@' + rule.name + separator + minifiedPrelude + '{' + body + '}';
}

/**
 * Finds the index of the closing parenthesis that matches the opening
 * parenthesis at the given position in the string.
 *
 * @param  {string} text       The string to search within.
 * @param  {number} openIndex  The index of the opening parenthesis.
 * @return {number}            The index of the matching closing parenthesis, or -1 if not found.
 */
function findMatchingCloseParenthesis (text, openIndex) {
  let depth = 0;
  for (let index = openIndex; index < text.length; index++) {
    if (text[index] === '(') {
      depth++;
    } else if (text[index] === ')') {
      depth--;
      if (depth === 0) {
        return index;
      }
    }
  }
  return -1;
}

/**
 * Extracts the type selector or universal selector from the beginning of a
 * compound selector string, if one is present. A type selector is a bare
 * element name (e.g. `div`, `a`); the universal selector is `*`.
 *
 * @param  {string}      compoundSelector  A single compound CSS selector string.
 * @return {string|null}                   The type or universal selector, or null if none is present.
 */
function extractTypeSelector (compoundSelector) {
  // Match universal selector (*) or type selector (letter followed by alphanumeric chars or hyphens)
  const match = compoundSelector.match(/^(\*|[a-zA-Z][a-zA-Z0-9-]*)/);
  if (match) {
    return match[0];
  }
  return null;
}

/**
 * Merges two simple/compound selectors into a single compound selector,
 * ensuring any type or universal selector appears first. Returns null when
 * merging is invalid because both sides contain a type or universal selector.
 *
 * @param  {string}      left   The first selector to merge.
 * @param  {string}      right  The second selector to merge.
 * @return {string|null}        The merged compound selector, or null if the merge is invalid.
 */
function mergeCompoundSelectors (left, right) {
  const leftTypeSelector = extractTypeSelector(left);
  const rightTypeSelector = extractTypeSelector(right);
  if (leftTypeSelector && rightTypeSelector) {
    return null;
  }
  // When the right side has a type selector, it must come first in the compound
  if (rightTypeSelector) {
    return right + left;
  }
  return left + right;
}

/**
 * Builds the cartesian product of two selector lists by merging every
 * combination of left and right selectors into compound selectors.
 * Returns null if any combination produces an invalid merge.
 *
 * @param  {Array}      leftParts   Selectors from the first `:where()`.
 * @param  {Array}      rightParts  Selectors from the second `:where()`.
 * @return {Array|null}             The array of merged compound selectors, or null if any merge is invalid.
 */
function buildWhereCartesianProduct (leftParts, rightParts) {
  const products = [];
  for (const leftSelector of leftParts) {
    for (const rightSelector of rightParts) {
      const merged = mergeCompoundSelectors(leftSelector.trim(), rightSelector.trim());
      if (merged === null) {
        return null;
      }
      products.push(merged);
    }
  }
  return products;
}

/**
 * Scans a selector string for adjacent `:where(A):where(B)` patterns and
 * merges them into a single `:where(AB)` (or `:where()` with the cartesian
 * product of their selector lists) when the merged form is strictly shorter.
 * Type selectors are correctly repositioned to the front of each merged
 * compound, and merges that would produce invalid compound selectors (two
 * type selectors) are skipped.
 *
 * @param  {string} selector  A minified CSS selector string.
 * @return {string}           The selector with beneficial adjacent `:where()` merges applied.
 */
function mergeAdjacentWherePseudoClasses (selector) {
  let result = selector;
  let position = 0;
  while (position < result.length) {
    const whereIndex = result.indexOf(':where(', position);
    if (whereIndex === -1) {
      break;
    }
    // Index of the '(' in the first ':where('
    const firstOpenParenthesis = whereIndex + 6;
    const firstCloseParenthesis = findMatchingCloseParenthesis(result, firstOpenParenthesis);
    if (firstCloseParenthesis === -1) {
      break;
    }
    const adjacentStart = firstCloseParenthesis + 1;
    const adjacentWhereTag = ':where(';
    if (result.slice(adjacentStart, adjacentStart + adjacentWhereTag.length) !== adjacentWhereTag) {
      position = firstCloseParenthesis + 1;
      continue;
    }
    // Index of the '(' in the second ':where('
    const secondOpenParenthesis = adjacentStart + 6;
    const secondCloseParenthesis = findMatchingCloseParenthesis(result, secondOpenParenthesis);
    if (secondCloseParenthesis === -1) {
      break;
    }
    const firstInnerContent = result.slice(firstOpenParenthesis + 1, firstCloseParenthesis);
    const secondInnerContent = result.slice(secondOpenParenthesis + 1, secondCloseParenthesis);
    const leftParts = splitParametersByComma(firstInnerContent);
    const rightParts = splitParametersByComma(secondInnerContent);
    const mergedParts = buildWhereCartesianProduct(leftParts, rightParts);
    if (mergedParts === null) {
      position = firstCloseParenthesis + 1;
      continue;
    }
    const originalFragment = result.slice(whereIndex, secondCloseParenthesis + 1);
    const mergedFragment = ':where(' + mergedParts.join(',') + ')';
    if (mergedFragment.length < originalFragment.length) {
      result = result.slice(0, whereIndex) + mergedFragment + result.slice(secondCloseParenthesis + 1);
      // Don't advance position; the merged result may be adjacent to another :where()
    } else {
      position = firstCloseParenthesis + 1;
    }
  }
  return result;
}

/**
 * Processes a bare `:is()` selector by merging `:link`+`:visited` into `:any-link`,
 * de-duplicating, sorting alphabetically, and conditionally expanding into individual
 * selectors when all parts are simple type/universal selectors with no modifications.
 *
 * @param  {string} selector  A minified CSS selector string.
 * @return {Array}            An array of one or more processed selector strings.
 */
function processIsSelector (selector) {
  // Replace :is(:link,:visited) and :is(:visited,:link) with :any-link
  selector = selector.replace(/:is\(:link,:visited\)/g, ':any-link');
  selector = selector.replace(/:is\(:visited,:link\)/g, ':any-link');
  // Only process bare :is() selectors (where :is() is the entire selector)
  if (!selector.startsWith(':is(')) {
    return [selector];
  }
  let depth = 0;
  let closingIndex = -1;
  for (let index = 4; index < selector.length; index++) {
    if (selector[index] === '(') {
      depth++;
    } else if (selector[index] === ')') {
      if (depth === 0) {
        closingIndex = index;
        break;
      }
      depth--;
    }
  }
  if (closingIndex !== selector.length - 1) {
    return [selector];
  }
  const content = selector.slice(4, -1);
  let parts = [];
  let currentPart = '';
  let parenDepth = 0;
  for (const character of content) {
    if (character === '(') {
      parenDepth++;
    } else if (character === ')') {
      parenDepth--;
    }
    if (character === ',' && parenDepth === 0) {
      parts.push(currentPart);
      currentPart = '';
    } else {
      currentPart += character;
    }
  }
  parts.push(currentPart);
  const originalCount = parts.length;
  // Replace :link + :visited with :any-link
  const hasLink = parts.includes(':link');
  const hasVisited = parts.includes(':visited');
  if (hasLink && hasVisited) {
    parts = parts.filter((part) => {
      return part !== ':link' && part !== ':visited';
    });
    if (!parts.includes(':any-link')) {
      parts.push(':any-link');
    }
  }
  // De-duplicate
  parts = [...new Set(parts)];
  // Sort alphabetically
  parts.sort();
  // Unwrap :is() with a single selector
  if (parts.length === 1) {
    return parts;
  }
  // Expand if all parts are simple type/universal selectors and no dedup/replacement occurred
  const allSimple = parts.every((part) => {
    return /^[a-z*][a-z0-9-]*$/i.test(part);
  });
  if (allSimple && parts.length === originalCount) {
    return parts;
  }
  return [':is(' + parts.join(',') + ')'];
}

/**
 * Removes spaces after commas only inside parenthesized groups (function
 * calls like `var()`, `calc()`), leaving top-level comma spacing intact.
 *
 * @param  {string} value  The whitespace-collapsed custom property value.
 * @return {string}        The value with post-comma spaces removed inside function calls only.
 */
function removeSpacesAfterCommasInsideFunctions (value) {
  let result = '';
  let parenthesisDepth = 0;
  for (let index = 0; index < value.length; index++) {
    const character = value[index];
    if (character === '(') {
      parenthesisDepth++;
    }
    if (character === ')') {
      parenthesisDepth--;
    }
    if (character === ',' && parenthesisDepth > 0) {
      result += ',';
      // Skip whitespace after the comma inside function calls
      while (index + 1 < value.length && value[index + 1] === ' ') {
        index++;
      }
    } else {
      result += character;
    }
  }
  return result;
}

/**
 * Strips leading zeros from decimal numbers in a custom property value
 * (e.g. `0.5` becomes `.5`, `-0.02em` becomes `-.02em`).
 *
 * @param  {string} value  The custom property value string.
 * @return {string}        The value with leading zeros removed from decimals.
 */
function stripLeadingZerosFromDecimals (value) {
  // Match a boundary (start, whitespace, comma, open-paren), optional sign, then leading zeros before a decimal
  return value.replace(/(^|\s|,|\()(-?)0+(\.\d+)/g, '$1$2$3');
}

/**
 * Processes CSS comments within a custom property value. If the value
 * consists entirely of a comment, the comment is removed (producing an
 * empty value). If comments appear between other tokens, their content
 * is stripped but empty comment delimiters are kept as zero-width
 * token separators to preserve the token sequence.
 *
 * @param  {string} value  The raw custom property value string.
 * @return {string}        The value with comments processed.
 */
function processCustomPropertyComments (value) {
  // Match values that are entirely a comment (with optional surrounding whitespace)
  const commentOnlyPattern = /^\s*\/\*.*?\*\/\s*$/s;
  if (commentOnlyPattern.test(value)) {
    return '';
  }
  // Strip comment content but keep empty markers as token separators
  return value.replace(/\/\*.*?\*\//g, '/**/');
}

/**
 * Collapses whitespace in a custom property value while preserving
 * token boundaries. Each whitespace sequence is reduced to a single
 * space, spaces after commas inside function calls are removed, and
 * leading zeros on decimal numbers are stripped.
 *
 * @param  {string} value  The raw custom property value string.
 * @return {string}        The minified custom property value.
 */
function collapseCustomPropertyWhitespace (value) {
  // Collapse all whitespace sequences (newlines, tabs, multiple spaces) to a single space
  let collapsed = value.replace(/\s+/g, ' ');
  // Remove spaces after commas only inside function calls (e.g. var(--bar, 1.5) → var(--bar,1.5))
  collapsed = removeSpacesAfterCommasInsideFunctions(collapsed);
  // Strip leading zeros from decimals (e.g. 0.5 → .5, -0.02em → -.02em)
  collapsed = stripLeadingZerosFromDecimals(collapsed);
  return collapsed;
}

/**
 * Converts a parsed CSS AST rule node into a minified CSS string, dispatching to specialized handlers for each rule type including selectors, `@media`, `@keyframes`, `@layer`, and other at-rules.
 *
 * @param  {object}  rule     The AST rule node to stringify.
 * @param  {object}  context  The minification context with registered custom property data.
 * @param  {boolean} nested   Whether this rule is nested inside another rule, affecting spacing.
 * @return {string}           The minified CSS string for this rule, or an empty string if the rule is empty.
 */
function stringifyRule (rule, context, nested = false) {
  if (rule.type === 'rule') {
    let declarations = rule.declarations
      ?.filter((declaration) => {
        return declaration.type !== 'whitespace';
      }) || [];

    // Ignore empty rules (comments-only rules are also effectively empty)
    const isEffectivelyEmpty = (
      declarations.length === 0 ||
      declarations.every((declaration) => {
        return declaration.type === 'comment' && !declaration.comment?.startsWith('!');
      })
    );
    if (isEffectivelyEmpty) {
      return '';
    }

    let output = [];
    if (rule.selectors?.length) {
      let uniqueSelectors = [...new Set(rule.selectors)];
      // Minify spacing within selectors (e.g. inside :is(), :where(), etc)
      uniqueSelectors = uniqueSelectors.map((selector) => {
        let minified = unescapeSelector(selector);
        // Collapse whitespace to single space
        minified = minified.replace(/\s+/g, ' ');
        // Strip whitespace around selector combinators and commas
        minified = minified.replace(/\s*([,>+~])\s*/g, '$1');
        // Strip whitespace inside parentheses for pseudo-class arguments
        minified = minified.replace(/\(\s+/g, '(').replace(/\s+\)/g, ')');
        // Simplify :nth-child(2n+1) to :nth-child(odd)
        minified = minified.replace(/:nth-child\(2n\s*\+\s*1\)/g, ':nth-child(odd)');
        // Simplify :nth-child(2n+0) to :nth-child(2n)
        minified = minified.replace(/:nth-child\(2n\s*\+\s*0\)/g, ':nth-child(2n)');
        // Simplify :nth-child(1n) to :nth-child(n)
        minified = minified.replace(/:nth-child\(1n\)/g, ':nth-child(n)');
        // Remove unnecessary leading + sign from :nth-child()
        minified = minified.replace(/:nth-child\(\+\s*(\d+)\)/g, ':nth-child($1)');
        // Simplify :nth-child(0n+N) to :nth-child(N)
        minified = minified.replace(/:nth-child\(0n\s*\+\s*(\d+)\)/g, ':nth-child($1)');
        // Replace :nth-child(1) with :first-child
        minified = minified.replace(/:nth-child\(1\)/g, ':first-child');
        // Replace :nth-last-child(1) with :last-child
        minified = minified.replace(/:nth-last-child\(1\)/g, ':last-child');
        // Replace :nth-of-type(1) with :first-of-type
        minified = minified.replace(/:nth-of-type\(1\)/g, ':first-of-type');
        // Replace :nth-last-of-type(1) with :last-of-type
        minified = minified.replace(/:nth-last-of-type\(1\)/g, ':last-of-type');
        // Convert double-colon pseudo-elements to single-colon legacy form
        minified = minified.replace(/::before/g, ':before');
        minified = minified.replace(/::after/g, ':after');

        // Strip redundant universal selector `*` when it precedes an ID, class, or attribute selector
        minified = minified.replace(/\*([#.[])/g, '$1');

        // Minify double-quoted attribute selectors: remove inner whitespace and escape when shorter
        minified = minified.replace(/\[\s*([^=]+)\s*=\s*"(.*?)"\s*\]/g, (match, attribute, value) => {
          // Escape special characters that require quoting (spaces, #, ., :, /, ;), and compare lengths
          let escaped = value.replace(/([ #.:/;])/g, '\\$1');
          if (escaped.length < value.length + 2) {
            return '[' + attribute + '=' + escaped + ']';
          }
          return '[' + attribute + '="' + value + '"]';
        });
        // Minify single-quoted attribute selectors: remove inner whitespace and escape when shorter
        minified = minified.replace(/\[\s*([^=]+)\s*=\s*'(.*?)'\s*\]/g, (match, attribute, value) => {
          // Escape special characters that require quoting (spaces, #, ., :, /, ;), and compare lengths
          let escaped = value.replace(/([ #.:/;])/g, '\\$1');
          if (escaped.length < value.length + 2) {
            return '[' + attribute + '=' + escaped + ']';
          }
          return '[' + attribute + '="' + value + '"]';
        });
        // Minify unquoted attribute selectors: quote when unescaping produces a shorter result
        minified = minified.replace(/\[\s*([^=]+)\s*=\s*([^"'].*?)\s*\]/g, (match, attribute, value) => {
          // Unescape special characters (spaces, #, ., :, /, ;) and compare with quoted form
          let unescaped = value.replace(/\\([ #.:/;])/g, '$1');
          if (unescaped.length + 2 < value.length) {
            return '[' + attribute + '="' + unescaped + '"]';
          }
          return '[' + attribute + '=' + value + ']';
        });

        // Minify logical combinations
        minified = minified.replace(/(?<=\b(?:button|fieldset|form|input|select|textarea)):not\(:invalid\)/g, ':valid');
        minified = minified.replace(/:not\(:dir\(ltr\)\)/g, ':dir(rtl)');
        minified = minified.replace(/:not\(:not\((.*?)\)\)/g, '$1');
        minified = minified.replace(/:not\(:enabled\)/g, ':disabled');
        minified = minified.replace(/:not\(:required\)/g, ':optional');
        minified = minified.replace(/(^|[\s,>+~])(a|area|link)(?:\[.*?\])*(?::where\()?:not\(:link\)\)?/g, (match) => {
          return match.replace(':not(:link)', ':visited');
        });
        // Remove redundant leading "& " nesting selector
        minified = minified.replace(/^& /, '');
        minified = mergeAdjacentWherePseudoClasses(minified);
        return minified;
      });
      uniqueSelectors = uniqueSelectors.flatMap(processIsSelector);
      uniqueSelectors = [...new Set(uniqueSelectors)];
      output.push(uniqueSelectors.join(','));
    }
    output.push('{');

    declarations = processDeclarations(declarations, context);

    // We need to properly output nested rules vs normal declarations.
    // Wait, the processDeclarations will now correctly keep 'rule' types because we push them in processDeclarations.
    // If we have `.foo { .bar { color: red; } }`, the inner rule is a declaration of type 'rule' with selectors: ['.bar'].
    // The previous stringifyRule recursively calls stringifyRule.

    let innerDeclarations = declarations.filter((declaration) => {
      return declaration.type !== 'rule' && declaration.type !== 'media';
    });
    let nestedRules = declarations.filter((declaration) => {
      return declaration.type === 'rule' || declaration.type === 'media';
    });

    let renderedDeclarations = innerDeclarations
      .map((declaration) => {
        if (!declaration.property) {
          return '';
        }
        const property = unescapeIdent(declaration.property);
        let value;
        if (property.startsWith('--')) {
          const syntax = context.registeredCustomPropertySyntax.get(property);
          if (syntax === '"<color>"') {
            value = minifyValue(declaration);
          } else {
            const rawValue = declaration.rawValue || declaration.value || '';
            const commentProcessedValue = processCustomPropertyComments(rawValue);
            const trimmedRawValue = commentProcessedValue.trim();
            if (trimmedRawValue === '') {
              const hasExplicitValueContent = commentProcessedValue.length > 0;
              // When the parser absorbs a whitespace-only value into
              // rawBetween, trailing whitespace after the colon signals an
              // intentionally empty custom property (e.g. `--foo: ;` sets
              // the value to a space token, which differs from an absent
              // value). Only apply this check when the original rawValue
              // was already empty — not when it became empty after
              // stripping a comment.
              const originalValueWasEmpty = rawValue.trim() === '';
              const colonBetween = declaration.rawBetween || '';
              // Match whitespace after the colon character
              const hasSpaceAfterColon = /:\s/.test(colonBetween);
              const isExplicitlyEmptyValue = hasExplicitValueContent || (originalValueWasEmpty && hasSpaceAfterColon);
              value = isExplicitlyEmptyValue ? ' ' : '';
            // Preserve leading space for rgb() space-syntax values in custom properties
            } else if (/^rgb\(\s*\d+\s+\d+\s+\d+\s*\)$/i.test(trimmedRawValue)) {
              value = ' ' + trimmedRawValue;
            } else {
              value = collapseCustomPropertyWhitespace(trimmedRawValue);
            }
          }
        } else {
          value = minifyValue(declaration);
        }
        return [property, ':', value].join('');
      })
      .join(';');

    let renderedNested = nestedRules.map((nestedRule) => {
      return stringifyRule(nestedRule, context, true);
    }).join('');

    output.push(renderedDeclarations);
    if (renderedDeclarations && renderedNested && !renderedDeclarations.endsWith(';')) {
      output.push(';');
    }
    output.push(renderedNested);

    output.push('}');
    return output.join('');
  }

  if (rule.type === 'media') {
    const normalizedMedia = normalizeMedia(rule.media);
    let separator;
    if (nested && normalizedMedia.startsWith('(')) {
      separator = '';
    } else {
      separator = ' ';
    }
    const items = rule.rules || [];
    const mediaDeclarations = items.filter((item) => {
      return item.type === 'declaration' && item.property;
    });
    const subRules = items.filter((item) => {
      return item.type !== 'declaration';
    });
    const renderedDeclarations = mediaDeclarations.map((declaration) => {
      return [unescapeIdent(declaration.property), ':', minifyValue(declaration)].join('');
    }).join(';');
    const renderedRules = subRules.map((childRule) => {
      return stringifyRule(childRule, context, false);
    }).join('');
    const children = [renderedDeclarations, renderedRules].filter(Boolean).join('');
    if (!children) {
      return '';
    }
    return '@media' + separator + normalizedMedia + '{' + children + '}';
  }

  if (rule.type === 'starting-style') {
    const children = stringifyChildRules(rule.rules, context);
    if (!children) {
      return '';
    }
    return '@starting-style{' + children + '}';
  }

  if (rule.type === 'scope') {
    // Collapse whitespace around "to" keyword in @scope condition
    const scope = (rule.scope || '').trim().replace(/\s+to\s+/g, 'to ');
    const children = stringifyChildRules(rule.rules, context);
    if (!children) {
      return '';
    }
    return '@scope' + scope + '{' + children + '}';
  }

  if (rule.type === 'supports') {
    let supports = normalizeSupports(rule.supports);
    let children = stringifyChildRules(rule.rules, context);
    if (!children) {
      return '';
    }
    if (canUnwrapSupports(supports)) {
      return children;
    }
    // Check if @supports condition has adjacent logical operators that allow tight spacing
    const needsTightSpacing = supports.startsWith('(') && /\)(?:and|or)\s*\(/.test(supports);
    let supportsSeparator;
    if (needsTightSpacing) {
      supportsSeparator = '';
    } else {
      supportsSeparator = ' ';
    }
    return '@supports' + supportsSeparator + supports + '{' + children + '}';
  }

  if (rule.type === 'keyframes') {
    let children = (rule.keyframes || [])
      .filter((keyframe) => {
        return keyframe.type === 'keyframe';
      })
      .filter((keyframe) => {
        // Skip keyframe stops that have no meaningful declarations
        const meaningful = (keyframe.declarations || []).filter((declaration) => {
          return declaration.type !== 'whitespace' && declaration.type !== 'comment';
        });
        return meaningful.length > 0;
      })
      .map((keyframe) => {
        let output = [];
        let stopValues = keyframe.values.map((stopValue) => {
          if (stopValue === 'from') {
            return '0%';
          }
          if (stopValue === '100%') {
            return 'to';
          }
          return stopValue;
        });
        output.push(stopValues.join(','));
        output.push('{');
        const renderedKeyframeDeclarations = keyframe.declarations
          ?.filter((declaration) => {
            return declaration.type !== 'whitespace' && declaration.type !== 'comment';
          })
          ?.map((declaration) => {
            return [declaration.property, ':', minifyValue(declaration)].join('');
          })
          .join(';') || '';
        output.push(renderedKeyframeDeclarations);
        output.push('}');
        return output.join('');
      }).join('');
    if (!children) {
      return '';
    }
    return '@keyframes ' + rule.name + '{' + children + '}';
  }

  if (rule.type === 'font-face') {
    let renderedDeclarations = stringifyDeclarations(rule.declarations || []);
    if (!renderedDeclarations) {
      return '';
    }
    return '@font-face{' + renderedDeclarations + '}';
  }

  if (rule.type === 'charset') {
    return '@charset ' + rule.charset + ';';
  }

  if (rule.type === 'import') {
    let importStatement = rule.import;
    // Unwrap url() with a quoted string to just the quoted string
    importStatement = importStatement.replace(/url\(\s*(".*?"|'.*?')\s*\)/g, '$1');
    // Unwrap url() with an unquoted path and add quotes
    importStatement = importStatement.replace(/url\(\s*(.*?)\s*\)/g, '"$1"');
    // Collapse whitespace in the import statement
    importStatement = importStatement.replace(/\s+/g, ' ').trim();
    // Remove space immediately after the quoted URL path
    importStatement = importStatement.replace(/^(".*?"|'.*?') /, '$1');
    // Remove space between closing paren and next at-rule condition keyword
    importStatement = importStatement.replace(/\) ([a-zA-Z])/g, ')$1');
    // Minify property:value pairs inside supports() by removing whitespace around colons
    importStatement = importStatement.replace(
      /supports\(([^()]*)\)/g,
      (fullMatch, content) => {
        return 'supports(' + content.replace(/\s*:\s*/g, ':') + ')';
      }
    );
    const startsWithQuote = importStatement.startsWith('"') || importStatement.startsWith('\'');
    let importSeparator;
    if (startsWithQuote) {
      importSeparator = '';
    } else {
      importSeparator = ' ';
    }
    return '@import' + importSeparator + importStatement + ';';
  }

  if (rule.type === 'layer') {
    if (rule.rules && rule.rules.length) {
      return '@layer ' + (rule.layer || '') + '{' + stringifyChildRules(rule.rules, context) + '}';
    } else {
      return '@layer ' + rule.layer + ';';
    }
  }

  if (rule.type === 'property') {
    let renderedDeclarations = stringifyDeclarations(rule.declarations || []);
    if (!renderedDeclarations) {
      return '';
    }
    return '@property ' + rule.name + '{' + renderedDeclarations + '}';
  }

  if (rule.type === 'container') {
    // Minify @container condition: collapse whitespace and strip spaces around punctuation
    let container = rule.container
      .replace(/\s+/g, ' ')
      .replace(/\s*([:,])\s*/g, '$1')
      .replace(/\s*([=<>])\s*/g, '$1')
      .replace(/\(\s+/g, '(')
      .replace(/\s+\)/g, ')');
    // Convert min-width/max-width to range syntax (e.g. min-width:768px → width>=768px)
    container = container.replace(/min-width:(\d+px)/gi, 'width>=$1').replace(/max-width:(\d+px)/gi, 'width<=$1');
    let children = stringifyChildRules(rule.rules, context);
    if (!children) {
      return '';
    }
    let containerSeparator;
    if (container.startsWith('(')) {
      containerSeparator = '';
    } else {
      containerSeparator = ' ';
    }
    return '@container' + containerSeparator + container + '{' + children + '}';
  }

  if (rule.type === 'page') {
    const trimmedSelectors = (rule.selectors || []).map((selector) => {
      return selector.trim();
    }).filter(Boolean);
    const selectorString = trimmedSelectors.join(',');
    let pageSeparator = '';
    if (selectorString) {
      if (selectorString.startsWith(':')) {
        pageSeparator = '';
      } else {
        pageSeparator = ' ';
      }
    }
    const parts = (rule.declarations || [])
      .filter((declaration) => {
        return declaration.type !== 'whitespace';
      })
      .flatMap((declaration) => {
        if (declaration.type === 'page-margin-box' && declaration.name) {
          const innerDeclarations = (declaration.declarations || [])
            .filter((innerDeclaration) => {
              return innerDeclaration.type !== 'whitespace' && innerDeclaration.property;
            })
            .map((innerDeclaration) => {
              return [unescapeIdent(innerDeclaration.property), ':', minifyValue(innerDeclaration)].join('');
            })
            .join(';');
          if (innerDeclarations) {
            return ['@' + declaration.name + '{' + innerDeclarations + '}'];
          }
          return [];
        }
        if (declaration.property) {
          return [[unescapeIdent(declaration.property), ':', minifyValue(declaration)].join('')];
        }
        return [];
      });
    if (!parts.length) {
      return '';
    }
    return '@page' + pageSeparator + selectorString + '{' + parts.join(';') + '}';
  }

  if (rule.type === 'counter-style') {
    let renderedDeclarations = stringifyDeclarations(rule.declarations || []);
    if (!renderedDeclarations) {
      return '';
    }
    return '@counter-style ' + rule.name + '{' + renderedDeclarations + '}';
  }

  if (rule.type === 'position-try') {
    let renderedDeclarations = stringifyDeclarations(rule.declarations || []);
    if (!renderedDeclarations) {
      return '';
    }
    return '@position-try ' + rule.name + '{' + renderedDeclarations + '}';
  }

  if (rule.type === 'document') {
    const children = stringifyChildRules(rule.rules, context);
    if (!children) {
      return '';
    }
    const vendor = rule.vendor || '';
    const condition = (rule.document || '')
      .trim()
      // Remove spaces between document condition function calls (e.g. "), " → ",")
      .replace(/\)\s*,\s*/g, '),');
    return '@' + vendor + 'document ' + condition + '{' + children + '}';
  }

  if (rule.type === 'comment') {
    if (rule.comment.startsWith('!')) {
      return '/*' + rule.comment + '*/';
    }
    return '';
  }

  if (rule.type === 'at-rule') {
    return stringifyAtRule(rule, context);
  }

  return ''; // Ignore unknown for now
}

export { stringifyRule };

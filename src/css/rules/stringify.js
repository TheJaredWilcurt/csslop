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
        // Basic selector minify
        minified = minified.replace(/\s+/g, ' ');
        minified = minified.replace(/\s*([,>+~])\s*/g, '$1');
        // Space around parenthesis for pseudo-classes
        minified = minified.replace(/\(\s+/g, '(').replace(/\s+\)/g, ')');
        // Minify nth-child
        // Simplify common :nth-child() expressions to shorter equivalents
        minified = minified.replace(/:nth-child\(2n\s*\+\s*1\)/g, ':nth-child(odd)');
        minified = minified.replace(/:nth-child\(2n\s*\+\s*0\)/g, ':nth-child(2n)');
        minified = minified.replace(/:nth-child\(1n\)/g, ':nth-child(n)');
        minified = minified.replace(/:nth-child\(\+\s*(\d+)\)/g, ':nth-child($1)');
        minified = minified.replace(/:nth-child\(0n\s*\+\s*(\d+)\)/g, ':nth-child($1)');
        minified = minified.replace(/:nth-child\(1\)/g, ':first-child');
        minified = minified.replace(/:nth-last-child\(1\)/g, ':last-child');
        minified = minified.replace(/:nth-of-type\(1\)/g, ':first-of-type');
        minified = minified.replace(/:nth-last-of-type\(1\)/g, ':last-of-type');
        minified = minified.replace(/::before/g, ':before'); // Some legacy conversions
        minified = minified.replace(/::after/g, ':after');

        // Strip redundant universal selector `*` when it precedes an ID, class, or attribute selector
        minified = minified.replace(/\*([#.[])/g, '$1');

        // Minify attribute selectors: remove inner whitespace and strip quotes when the escaped form is shorter
        minified = minified.replace(/\[\s*([^=]+)\s*=\s*"(.*?)"\s*\]/g, (match, attribute, value) => {
          // If the value contains characters that need quoting vs escaping, decide based on length
          let escaped = value.replace(/([#.:/])/g, '\\$1');
          if (escaped.length < value.length + 2) {
            return '[' + attribute + '=' + escaped + ']';
          }
          return '[' + attribute + '="' + value + '"]';
        });
        minified = minified.replace(/\[\s*([^=]+)\s*=\s*'(.*?)'\s*\]/g, (match, attribute, value) => {
          let escaped = value.replace(/([#.:/])/g, '\\$1');
          if (escaped.length < value.length + 2) {
            return '[' + attribute + '=' + escaped + ']';
          }
          return '[' + attribute + '="' + value + '"]';
        });
        minified = minified.replace(/\[\s*([^=]+)\s*=\s*([^"'].*?)\s*\]/g, (match, attribute, value) => {
          let unescaped = value.replace(/\\([#.:/])/g, '$1');
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
        minified = minified.replace(/:is\(:link,:visited\)/g, ':any-link');
        minified = minified.replace(/:is\(:visited,:link\)/g, ':any-link');
        minified = minified.replace(/^& /, '');
        return minified;
      });
      uniqueSelectors = uniqueSelectors.flatMap((selector) => {
        const isMatch = selector.match(/^:is\(([^()]+)\)$/);
        if (isMatch) {
          const parts = isMatch[1].split(',').map((part) => {
            return part.trim();
          });
          const allSimple = parts.every((part) => {
            return /^[a-z*][a-z0-9-]*$/i.test(part);
          });
          if (allSimple) {
            return parts;
          }
        }
        return [selector];
      });
      uniqueSelectors = [...new Set(uniqueSelectors)];
      const headingSet = new Set(['h1', 'h2', 'h3', 'h4', 'h5', 'h6']);
      const isAllHeadings = (
        rule.selectors.length === 6 &&
        uniqueSelectors.length === 6 &&
        uniqueSelectors.every((selector) => {
          return headingSet.has(selector);
        })
      );
      if (isAllHeadings) {
        uniqueSelectors = [':heading'];
      }
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
            const trimmedRawValue = rawValue.trim();
            if (trimmedRawValue === '') {
              value = ' ';
            } else if (/^rgb\(\s*\d+\s+\d+\s+\d+\s*\)$/i.test(trimmedRawValue)) {
              value = ' ' + trimmedRawValue;
            } else {
              value = trimmedRawValue;
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
            return declaration.type !== 'whitespace';
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
    importStatement = importStatement.replace(/url\(\s*(".*?"|'.*?')\s*\)/g, '$1');
    importStatement = importStatement.replace(/url\(\s*(.*?)\s*\)/g, '"$1"');
    importStatement = importStatement.replace(/\s+/g, ' ').trim();
    // Remove space immediately after the quoted URL
    importStatement = importStatement.replace(/^(".*?"|'.*?') /, '$1');
    // Remove spaces between adjacent at-rule conditions (after ')' before next word)
    importStatement = importStatement.replace(/\) ([a-zA-Z])/g, ')$1');
    // Minify property:value pairs inside supports()
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
    let container = rule.container
      .replace(/\s+/g, ' ')
      .replace(/\s*([:,])\s*/g, '$1')
      .replace(/\s*([=<>])\s*/g, '$1')
      .replace(/\(\s+/g, '(')
      .replace(/\s+\)/g, ')');
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

  if (rule.type === 'comment') {
    if (rule.comment.startsWith('!')) {
      return '/*' + rule.comment + '*/';
    }
    return '';
  }

  return ''; // Ignore unknown for now
}

export { stringifyRule };

/**
 * @file Handles `@position-try` rule analysis, usage tracking, and dead-rule elimination during CSS minification.
 */

/**
 * Scans top-level rules to register `@property` custom properties in the context and collect `@position-try` rule declarations and initial usage counts.
 *
 * @param  {Array}  rules    The top-level AST rule nodes to scan.
 * @param  {object} context  The minification context to populate with custom property registrations.
 * @return {object}          An object with positionTryRules Map and positionTryUsage Map.
 */
function collectRuleMetadata (rules, context) {
  const positionTryRules = new Map();
  const positionTryUsage = new Map();

  for (const rule of rules) {
    if (rule.type === 'property' && rule.name) {
      context.registeredCustomProperties.add(rule.name);
      const syntaxDeclaration = (rule.declarations || []).find((declaration) => {
        return declaration.type !== 'whitespace' && declaration.property === 'syntax';
      });
      if (syntaxDeclaration?.value) {
        context.registeredCustomPropertySyntax.set(rule.name, syntaxDeclaration.value);
      }
    }
    if (rule.type === 'position-try') {
      const declarations = (rule.declarations || []).filter((declaration) => {
        return declaration.type !== 'whitespace';
      });
      if (declarations.length > 0) {
        positionTryRules.set(rule.name, declarations);
        positionTryUsage.set(rule.name, 0);
      }
    }
  }

  return {
    positionTryRules,
    positionTryUsage
  };
}

/**
 * Walks rules to resolve position-try-fallbacks references, replacing simple single-declaration patterns with built-in keywords like flip-block and tracking usage counts.
 *
 * @param {Array}                    rules             The AST rule nodes to analyze.
 * @param {function(object): string} minifyValue       The value minification function for resolving declaration values.
 * @param {Map}                      positionTryRules  Map of `@position-try` names to their declaration arrays.
 * @param {Map}                      positionTryUsage  Map of `@position-try` names to their reference counts.
 */
function analyzePositionTryRules (rules, minifyValue, positionTryRules, positionTryUsage) {
  for (const rule of rules) {
    if (rule.type === 'rule') {
      let basePositionArea = null;
      for (const declaration of rule.declarations || []) {
        if (declaration.type !== 'whitespace' && declaration.property === 'position-area') {
          basePositionArea = minifyValue(declaration);
        }
      }

      for (const declaration of rule.declarations || []) {
        const isPositionTryProperty = (
          declaration.type !== 'whitespace' &&
          (declaration.property === 'position-try-fallbacks' || declaration.property === 'position-try')
        );
        if (!isPositionTryProperty) {
          continue;
        }

        const minifiedValue = minifyValue(declaration);
        const parts = minifiedValue.split(',').map((segment) => {
          return segment.trim();
        });
        const replacedParts = [];

        for (const part of parts) {
          if (!part.startsWith('--')) {
            replacedParts.push(part);
            continue;
          }

          if (!positionTryRules.has(part)) {
            replacedParts.push(part);
            continue;
          }

          const tryDeclarations = positionTryRules.get(part);
          const isSinglePositionArea = (
            tryDeclarations.length === 1 &&
            tryDeclarations[0].property === 'position-area' &&
            basePositionArea
          );

          if (isSinglePositionArea) {
            const tryValue = minifyValue(tryDeclarations[0]);
            const isVerticalFlip = (
              (basePositionArea === 'top' && tryValue === 'bottom') ||
              (basePositionArea === 'bottom' && tryValue === 'top')
            );

            if (isVerticalFlip && parts.length === 1) {
              replacedParts.push('flip-block');
              continue;
            }
          }

          replacedParts.push(part);
          const currentUsage = positionTryUsage.get(part);
          positionTryUsage.set(part, currentUsage + 1);
        }

        declaration.value = replacedParts.join(',');
      }
    } else if (rule.rules) {
      analyzePositionTryRules(rule.rules, minifyValue, positionTryRules, positionTryUsage);
    }
  }
}

/**
 * Removes empty position-try-fallbacks and position-try declarations left with blank values after analysis inlined their references.
 *
 * @param {Array} rules  The AST rule nodes to clean in place.
 */
function cleanPositionTryRules (rules) {
  for (const rule of rules) {
    if (rule.type === 'rule') {
      rule.declarations = (rule.declarations || []).filter((declaration) => {
        const isPositionTryProperty = (
          declaration.type !== 'whitespace' &&
          (declaration.property === 'position-try-fallbacks' || declaration.property === 'position-try')
        );
        if (isPositionTryProperty) {
          return declaration.value !== '';
        }
        return true;
      });
    } else if (rule.rules) {
      cleanPositionTryRules(rule.rules);
    }
  }
}

/**
 * Filters out unused `@position-try` rules whose references were fully inlined.
 *
 * @param  {Array} rules             The top-level AST rule nodes to filter.
 * @param  {Map}   positionTryRules  Map of `@position-try` names to their declaration arrays.
 * @param  {Map}   positionTryUsage  Map of `@position-try` names to their reference counts.
 * @return {Array}                   A new array of rules with unused `@position-try` entries removed.
 */
function filterUnusedPositionTry (rules, positionTryRules, positionTryUsage) {
  return rules.filter((rule) => {
    if (rule.type === 'position-try') {
      if (!positionTryRules.has(rule.name)) {
        return false;
      }
      if (positionTryUsage.get(rule.name) === 0) {
        return false;
      }
    }
    return true;
  });
}

/**
 * Removes duplicate and redundant UTF-8 `@charset` rules, keeping only the first
 * non-UTF-8 charset declaration and moving it to the top of the document.
 * Per the CSS specification, `@charset` must be the very first thing in a stylesheet.
 *
 * @param  {Array} rules  The top-level AST rule nodes to filter.
 * @return {Array}        A new array of rules with the first non-UTF-8 `@charset` at the start and all others removed.
 */
function filterRedundantCharsets (rules) {
  let keptCharset = null;

  const filtered = rules.filter((rule) => {
    if (rule.type !== 'charset') {
      return true;
    }
    if (!keptCharset) {
      // Strip surrounding quotes from the charset value for comparison
      const normalizedCharset = rule.charset?.toLowerCase().replace(/["']/g, '');
      if (normalizedCharset !== 'utf-8') {
        keptCharset = rule;
      }
    }
    return false;
  });

  if (keptCharset) {
    return [keptCharset, ...filtered];
  }
  return filtered;
}

export {
  analyzePositionTryRules,
  cleanPositionTryRules,
  collectRuleMetadata,
  filterRedundantCharsets,
  filterUnusedPositionTry
};

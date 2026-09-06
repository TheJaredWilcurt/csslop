/**
 * @file Optimizes CSS rule structures by merging selectors, deduplicating keyframes, nesting flat rules, and consolidating `@media` and `@layer` blocks.
 */

import {
  expandToLeafProperties,
  getOverridesOf
} from '../declarations/config.js';
import { escapeRegexString } from '../utilities.js';

import {
  normalizeLayerNames,
  normalizeMedia
} from './normalize.js';

/**
 * Expands rules that contain only nested sub-rules into flat rules with combined selectors, enabling further merging when the combined selectors already exist elsewhere.
 *
 * @param  {Array} rules  The AST rule nodes to process.
 * @return {Array}        A new array of rules with pure-nested rules expanded.
 */
function expandPureNestedRules (rules) {
  const flatSelectors = new Set();
  for (const rule of rules) {
    if (rule.type !== 'rule' || !rule.selectors?.length) {
      continue;
    }
    const nonWhitespace = (rule.declarations || []).filter((declaration) => {
      return declaration.type !== 'whitespace';
    });
    const hasNonRuleDeclarations = nonWhitespace.some((declaration) => {
      return declaration.type !== 'rule';
    });
    if (hasNonRuleDeclarations) {
      rule.selectors.forEach((selector) => {
        // Normalize selector whitespace to single space for deduplication
        flatSelectors.add(selector.trim().replace(/\s+/g, ' '));
      });
    }
  }

  const result = [];
  for (const rule of rules) {
    if (rule.type !== 'rule' || !rule.selectors?.length) {
      result.push(rule);
      continue;
    }
    const nonWhitespace = (rule.declarations || []).filter((declaration) => {
      return declaration.type !== 'whitespace';
    });
    const isPureNested = nonWhitespace.length > 0 && nonWhitespace.every((declaration) => {
      return declaration.type === 'rule';
    });
    // A comma-separated parent selector list behaves like :is() for specificity,
    // so expanding it into descendant combinations (e.g. #a,.b → #a .c,.b .c)
    // would change specificity. Only single-selector parents can expand safely.
    if (!isPureNested || rule.selectors.length !== 1) {
      result.push(rule);
      continue;
    }

    let anyMatch = false;
    let expandedRules = [];
    let canExpand = true;

    for (const nestedRule of nonWhitespace) {
      if (!nestedRule.selectors?.length) {
        canExpand = false;
        break;
      }
      // A child written as a comma-separated selector list, such as `.b,.c`,
      // repeats the parent in front of every item when expanded (`.a .b,.a .c`),
      // while the nested form states the parent once. Expanding is always
      // longer, and leaving the rule nested keeps one pass from expanding what
      // the next pass would then keep, so the output stays idempotent.
      if (nestedRule.selectors.length > 1) {
        canExpand = false;
        break;
      }
      const combinedSelectors = [];
      for (const parentSelector of rule.selectors) {
        for (const childSelector of nestedRule.selectors) {
          const trimmedChild = childSelector.trim();
          let combinedSelector;
          if (trimmedChild.startsWith('&')) {
            combinedSelector = trimmedChild.replace(/^&/, parentSelector.trim());
          } else {
            combinedSelector = parentSelector.trim() + ' ' + trimmedChild;
          }
          combinedSelectors.push(combinedSelector);
          if (flatSelectors.has(combinedSelector)) {
            anyMatch = true;
          }
        }
      }
      expandedRules.push({ ...nestedRule, selectors: combinedSelectors });
    }

    const allChildSelectorStrings = expandedRules.map((expandedRule) => {
      return expandedRule.selectors.join(',');
    });
    const allSame = (
      allChildSelectorStrings.length > 0 &&
      allChildSelectorStrings.every((selectorString) => {
        return selectorString === allChildSelectorStrings[0];
      })
    );
    if (canExpand && (allSame || anyMatch)) {
      for (const expandedRule of expandedRules) {
        result.push(expandedRule);
      }
    } else {
      result.push(rule);
    }
  }
  return result;
}

/**
 * Builds a reusable matcher that expresses child selectors as nested selectors
 * relative to one parent. The combinator pattern is compiled once per parent so
 * that testing many children against the same parent does not rebuild it.
 *
 * @param  {string}                          parentSelector  The parent selector string.
 * @return {function(string): (string|null)}                 A matcher returning the nested selector, or null when the child cannot be nested.
 */
function createNestedSelectorMatcher (parentSelector) {
  const parent = parentSelector.trim();
  // Match a child selector that starts with the parent followed by a combinator (>, +, ~)
  const combinatorPattern = new RegExp('^' + escapeRegexString(parent) + '\\s*([>+~])\\s*(.+)$');

  return (childSelector) => {
    const child = childSelector.trim();
    if (child.startsWith(parent + ':') || child.startsWith(parent + '::')) {
      return '&' + child.slice(parent.length);
    }
    if (child.startsWith(parent + ' ')) {
      return child.slice(parent.length + 1);
    }
    const combinatorMatch = child.match(combinatorPattern);
    if (combinatorMatch) {
      return combinatorMatch[1] + combinatorMatch[2];
    }
    return null;
  };
}

/**
 * Attempts to express a child selector as a nested selector relative to a parent, returning the nested form or null if nesting is not possible.
 *
 * @param  {string}      parentSel  The parent selector string.
 * @param  {string}      childSel   The child selector string to try nesting.
 * @return {string|null}            The nested selector using & syntax, or null if the child cannot be nested under the parent.
 */
function tryNestSelector (parentSel, childSel) {
  return createNestedSelectorMatcher(parentSel)(childSel);
}

/**
 * Determines whether a rule is effectively empty, containing no meaningful
 * CSS output after minification. A rule is effectively empty when it has
 * no declarations, or all of its entries are whitespace, non-important
 * comments, or recursively empty nested rules.
 *
 * @param  {object}  rule  The AST rule node to evaluate.
 * @return {boolean}       True if the rule produces no CSS output.
 */
function isRuleEffectivelyEmpty (rule) {
  if (rule.type !== 'rule') {
    return false;
  }
  const nonWhitespaceEntries = (rule.declarations || []).filter((declaration) => {
    return declaration.type !== 'whitespace';
  });
  if (nonWhitespaceEntries.length === 0) {
    return true;
  }
  return nonWhitespaceEntries.every((entry) => {
    if (entry.type === 'comment') {
      return !entry.comment?.startsWith('!');
    }
    if (entry.type === 'rule') {
      return isRuleEffectivelyEmpty(entry);
    }
    return false;
  });
}

/**
 * Filters out effectively empty rules from the rules array, preventing
 * empty rules from being nested into parent rules during later
 * optimization passes and producing incorrect non-empty output.
 *
 * @param  {Array} rules  The AST rule nodes to filter.
 * @return {Array}        A new array with effectively empty rules removed.
 */
function removeEmptyRules (rules) {
  return rules.filter((rule) => {
    return !isRuleEffectivelyEmpty(rule);
  });
}

/**
 * Determines whether a character is CSS whitespace.
 *
 * @param  {string}  character  A single character from a selector.
 * @return {boolean}            Whether the character is whitespace.
 */
function isSelectorWhitespace (character) {
  // Match a single whitespace character
  return (/\s/).test(character);
}

/**
 * Collects every prefix of a child selector that could act as its nesting
 * parent. A parent always ends immediately before a pseudo-class colon, a
 * descendant whitespace run, or the whitespace run leading into a combinator,
 * so only those few positions can start a nestable remainder. Enumerating them
 * turns "which earlier rule can host this one" into a set of key lookups
 * instead of a comparison against every preceding rule.
 *
 * @param  {string} childSelector  The trimmed child selector.
 * @return {Set}                   The candidate parent selector strings.
 */
function collectCandidateParentSelectors (childSelector) {
  const candidates = new Set();
  for (let index = 1; index < childSelector.length; index++) {
    const character = childSelector[index];
    if (character === ':' || isSelectorWhitespace(character)) {
      candidates.add(childSelector.slice(0, index));
      continue;
    }
    if (character !== '>' && character !== '+' && character !== '~') {
      continue;
    }
    // A combinator may be separated from its parent by whitespace, which
    // belongs to neither side, so the parent ends where that run begins.
    let boundary = index;
    while (boundary > 0 && isSelectorWhitespace(childSelector[boundary - 1])) {
      boundary--;
    }
    if (boundary > 0) {
      candidates.add(childSelector.slice(0, boundary));
    }
  }
  return candidates;
}

/**
 * Finds the most recently emitted rule that can host a child selector as a
 * nested rule, matching the behaviour of scanning backwards through the emitted
 * rules but only visiting the handful of rules whose selector is a viable
 * parent prefix.
 *
 * @param  {Array}       emittedRules     The rules emitted so far.
 * @param  {Map}         indexBySelector  Map of each emitted single-selector rule's selector to its index.
 * @param  {string}      childSelector    The trimmed child selector to nest.
 * @return {object|null}                  The `parentIndex` and `nestedSelector`, or null when nothing can host the child.
 */
function findNestingParent (emittedRules, indexBySelector, childSelector) {
  const parentIndexes = [];
  for (const candidateParent of collectCandidateParentSelectors(childSelector)) {
    const parentIndex = indexBySelector.get(candidateParent);
    if (parentIndex !== undefined) {
      parentIndexes.push(parentIndex);
    }
  }
  // The nearest preceding parent wins, exactly as a backwards scan would.
  parentIndexes.sort((first, second) => {
    return second - first;
  });
  for (const parentIndex of parentIndexes) {
    const nestedSelector = tryNestSelector(emittedRules[parentIndex].selectors[0], childSelector);
    if (nestedSelector !== null) {
      return {
        nestedSelector,
        parentIndex
      };
    }
  }
  return null;
}

/**
 * Groups flat CSS rules into nested structures where a child selector can be expressed relative to a preceding parent, reducing output size through CSS nesting.
 *
 * @param  {Array} rules  The flat AST rule nodes to nest.
 * @return {Array}        A new array of rules with applicable children nested under their parents.
 */
function nestFlatRules (rules) {
  const result = [];
  const indexBySelector = new Map();
  for (const rule of rules) {
    if (rule.type !== 'rule' || rule.selectors?.length !== 1) {
      result.push(rule);
      continue;
    }
    const childSelector = rule.selectors[0].trim();
    const nesting = findNestingParent(result, indexBySelector, childSelector);
    if (nesting) {
      const parentRule = result[nesting.parentIndex];
      parentRule.declarations = parentRule.declarations || [];
      parentRule.declarations.push({ ...rule, selectors: [nesting.nestedSelector] });
      continue;
    }
    indexBySelector.set(childSelector, result.length);
    result.push(rule);
  }
  for (const rule of result) {
    if (rule.type === 'rule' && rule.declarations) {
      const innerRules = rule.declarations.filter((declaration) => {
        return declaration.type === 'rule';
      });
      if (innerRules.length > 0) {
        const nonRuleDeclarations = rule.declarations.filter((declaration) => {
          return declaration.type !== 'rule';
        });
        rule.declarations = [...nonRuleDeclarations, ...nestFlatRules(innerRules)];
      }
    }
  }
  return result;
}

/**
 * Extracts the leading compound selector of a complex selector: everything up to
 * the first top-level combinator (descendant whitespace, `>`, `+`, or `~`).
 * Combinator characters nested inside `()` or `[]` (such as `:nth-child(2n+1)` or
 * `[a~=b]`) are ignored so only structural combinators split the selector.
 *
 * @param  {string}      selector  The selector string to inspect.
 * @return {string|null}           The leading compound selector, or null when the selector has no descendant part to factor out.
 */
function extractLeadingCompound (selector) {
  const trimmed = selector.trim();
  let bracketDepth = 0;
  for (let index = 0; index < trimmed.length; index++) {
    const character = trimmed[index];
    if (character === '(' || character === '[') {
      bracketDepth++;
    } else if (character === ')' || character === ']') {
      bracketDepth--;
    } else if (
      bracketDepth === 0 &&
      (character === ' ' || character === '>' || character === '+' || character === '~')
    ) {
      const compound = trimmed.slice(0, index).trim();
      return compound.length ? compound : null;
    }
  }
  return null;
}

/**
 * Groups consecutive sibling rules that share a common leading compound selector
 * (such as `.foo` in `.foo .a`, `.foo .b`) into a synthesized parent rule with the
 * shared portion factored out, but only when nesting trims more characters from the
 * child selectors than the wrapper itself costs.
 *
 * @param  {Array} rules  The flat AST rule nodes to factor.
 * @return {Array}        A new array of rules with shared parent selectors factored into nesting wrappers.
 */
function factorCommonParents (rules) {
  const result = [];
  let index = 0;
  while (index < rules.length) {
    const rule = rules[index];
    // Only single-selector style rules can act as a factoring candidate.
    if (rule.type !== 'rule' || rule.selectors?.length !== 1) {
      result.push(rule);
      index++;
      continue;
    }
    const candidateParent = extractLeadingCompound(rule.selectors[0]);
    if (candidateParent === null) {
      result.push(rule);
      index++;
      continue;
    }
    // Collect the run of consecutive rules that can all nest under the candidate.
    const matchNestedSelector = createNestedSelectorMatcher(candidateParent);
    const run = [];
    const nestedForms = [];
    let lookahead = index;
    while (lookahead < rules.length) {
      const sibling = rules[lookahead];
      if (sibling.type !== 'rule' || sibling.selectors?.length !== 1) {
        break;
      }
      const nestedSelector = matchNestedSelector(sibling.selectors[0]);
      if (nestedSelector === null) {
        break;
      }
      run.push(sibling);
      nestedForms.push(nestedSelector);
      lookahead++;
    }
    // The wrapper writes the shared selector once plus its surrounding braces.
    const wrapperCost = candidateParent.length + 2;
    const charactersSaved = run.reduce((total, sibling, position) => {
      return total + sibling.selectors[0].trim().length - nestedForms[position].length;
    }, 0);
    if (run.length >= 2 && charactersSaved > wrapperCost) {
      const children = run.map((sibling, position) => {
        return { ...sibling, selectors: [nestedForms[position]] };
      });
      result.push({
        type: 'rule',
        selectors: [candidateParent],
        // Recurse so deeper shared prefixes among the children also factor out.
        declarations: factorCommonParents(children)
      });
      index = lookahead;
    } else {
      result.push(rule);
      index++;
    }
  }
  return result;
}

/**
 * Merges adjacent `@media` rules that share an identical normalized query string and deduplicates their child selector rules.
 *
 * @param  {Array}                  rules               The AST rule nodes to process.
 * @param  {function(Array): Array} mergeSelectorRules  Callback to merge selector rules within each media block.
 * @return {Array}                                      A new array of rules with consecutive identical `@media` blocks combined.
 */
function mergeMediaRules (rules, mergeSelectorRules) {
  const mediaMap = new Map();
  const result = [];
  for (const rule of rules) {
    if (rule.type === 'media') {
      const normalizedQuery = normalizeMedia(rule.media);
      if (mediaMap.has(normalizedQuery)) {
        mediaMap.get(normalizedQuery).rules.push(...(rule.rules || []));
      } else {
        mediaMap.set(normalizedQuery, rule);
        result.push(rule);
      }
    } else {
      if (rule.type !== 'whitespace') {
        mediaMap.clear();
      }
      result.push(rule);
    }
  }
  for (const rule of result) {
    if (rule.type === 'media' && rule.rules && rule.rules.length) {
      rule.rules = mergeSelectorRules(rule.rules);
    }
  }
  return result;
}

/**
 * Removes duplicate `@keyframes` definitions, keeping only the last occurrence of each named animation.
 *
 * @param  {Array} rules  The AST rule nodes to deduplicate.
 * @return {Array}        A new array of rules with earlier duplicate `@keyframes` removed.
 */
function deduplicateKeyframes (rules) {
  const lastIndexByName = new Map();
  for (let i = 0; i < rules.length; i++) {
    if (rules[i].type === 'keyframes' && rules[i].name) {
      lastIndexByName.set(rules[i].name, i);
    }
  }
  return rules.filter((rule, index) => {
    if (rule.type === 'keyframes' && rule.name) {
      return lastIndexByName.get(rule.name) === index;
    }
    return true;
  });
}

/**
 * Removes duplicate selectors from a combined selector list by normalizing
 * whitespace and preserving the first occurrence of each unique selector.
 *
 * @param  {Array} selectors  The selector strings to deduplicate.
 * @return {Array}            A new array with duplicate selectors removed.
 */
function deduplicateSelectors (selectors) {
  const seen = new Set();
  return selectors.filter((selector) => {
    // Normalize whitespace to single spaces for consistent comparison
    const normalized = selector.trim().replace(/\s+/g, ' ');
    if (seen.has(normalized)) {
      return false;
    }
    seen.add(normalized);
    return true;
  });
}

/**
 * Merges consecutive rules whose declarations are a subset of the following rule, combining their selectors and splitting out any extra declarations.
 *
 * @param  {Array} rules  The AST rule nodes to merge.
 * @return {Array}        A new array of rules with declaration-compatible consecutive rules combined.
 */
function mergeByDeclarations (rules) {
  const result = [];
  for (const rule of rules) {
    if (rule.type !== 'rule' || !rule.selectors?.length) {
      result.push(rule);
      continue;
    }
    const previousRule = result[result.length - 1];
    if (previousRule && previousRule.type === 'rule' && previousRule.selectors?.length) {
      const previousDeclarations = (previousRule.declarations || []).filter((declaration) => {
        return declaration.type !== 'whitespace' && declaration.property;
      });
      const currentDeclarations = (rule.declarations || []).filter((declaration) => {
        return declaration.type !== 'whitespace' && declaration.property;
      });
      if (previousDeclarations.length > 0 && currentDeclarations.length > 0) {
        const currentDeclarationMap = new Map(
          currentDeclarations.map((declaration) => {
            return [declaration.property, (declaration.value || '').trim()];
          })
        );
        const previousIsSubset = previousDeclarations.every((declaration) => {
          return currentDeclarationMap.get(declaration.property) === (declaration.value || '').trim();
        });
        const currentHasAllProperty = currentDeclarations.some((declaration) => {
          return declaration.property === 'all';
        });
        if (previousIsSubset && !currentHasAllProperty) {
          const commonProperties = new Set(
            previousDeclarations.map((declaration) => {
              return declaration.property;
            })
          );
          const currentOnlyDeclarations = currentDeclarations.filter((declaration) => {
            return !commonProperties.has(declaration.property);
          });
          result.pop();
          const combinedSelectors = deduplicateSelectors([...previousRule.selectors, ...rule.selectors]);
          result.push({ ...previousRule, selectors: combinedSelectors });
          if (currentOnlyDeclarations.length > 0) {
            result.push({ ...rule, declarations: currentOnlyDeclarations });
          }
          continue;
        }
      }
    }
    result.push(rule);
  }
  return result;
}

/**
 * Splits a selector list on top-level commas, respecting parentheses and
 * brackets so commas inside `:is(...)` or `[attr="a,b"]` are not split.
 *
 * @param  {string} selectorList  The selector list string.
 * @return {Array}                The individual selector strings.
 */
function splitSelectorListTopLevel (selectorList) {
  const selectors = [];
  let current = '';
  let depth = 0;
  for (const character of selectorList) {
    if (character === '(' || character === '[') {
      depth++;
    } else if (character === ')' || character === ']') {
      depth--;
    }
    if (character === ',' && depth === 0) {
      selectors.push(current.trim());
      current = '';
    } else {
      current += character;
    }
  }
  selectors.push(current.trim());
  return selectors;
}

/**
 * Advances past a CSS identifier (name) starting at the given index.
 *
 * @param  {string} text   The selector text.
 * @param  {number} start  The index to start scanning from.
 * @return {number}        The index just after the identifier.
 */
function skipSelectorName (text, start) {
  let index = start;
  // Advance over identifier characters (letters, digits, hyphen, underscore)
  while (index < text.length && (/[a-zA-Z0-9_-]/).test(text[index])) {
    index++;
  }
  return index;
}

/**
 * Finds the index of the closing parenthesis matching the one at openIndex.
 *
 * @param  {string} text       The text to scan.
 * @param  {number} openIndex  Index of the opening parenthesis.
 * @return {number}            Index of the matching close parenthesis, or text length.
 */
function findMatchingParenthesisIndex (text, openIndex) {
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
  return text.length;
}

/**
 * Compares two specificity tuples [ids, classes, types] lexicographically.
 *
 * @param  {Array}  first   The first specificity tuple.
 * @param  {Array}  second  The second specificity tuple.
 * @return {number}         Negative, zero, or positive per standard comparison.
 */
function compareSpecificity (first, second) {
  for (let index = 0; index < 3; index++) {
    if (first[index] !== second[index]) {
      return first[index] - second[index];
    }
  }
  return 0;
}

/**
 * Computes the CSS specificity of a single complex selector as an
 * [ids, classes, types] tuple. The nesting selector `&` is ignored because its
 * contribution comes from the shared parent when comparing sibling selectors.
 * Functional pseudo-classes `:is()`, `:not()`, `:has()`, and `:matches()` add
 * the maximum specificity of their arguments; `:where()` adds nothing.
 *
 * @param  {string} selector  A single complex selector string.
 * @return {Array}            The [ids, classes, types] specificity tuple.
 */
function computeSpecificity (selector) {
  const specificity = [0, 0, 0];
  const text = selector.trim();
  let index = 0;
  while (index < text.length) {
    const character = text[index];
    if (character === '#') {
      specificity[0]++;
      index = skipSelectorName(text, index + 1);
    } else if (character === '.') {
      specificity[1]++;
      index = skipSelectorName(text, index + 1);
    } else if (character === '[') {
      specificity[1]++;
      // Advance to just past the matching closing bracket
      let bracketDepth = 0;
      while (index < text.length) {
        if (text[index] === '[') {
          bracketDepth++;
        } else if (text[index] === ']') {
          bracketDepth--;
          if (bracketDepth === 0) {
            index++;
            break;
          }
        }
        index++;
      }
    } else if (character === ':') {
      if (text[index + 1] === ':') {
        specificity[2]++;
        index = skipSelectorName(text, index + 2);
      } else {
        const nameStart = index + 1;
        const nameEnd = skipSelectorName(text, nameStart);
        const name = text.slice(nameStart, nameEnd).toLowerCase();
        if (text[nameEnd] === '(') {
          const closeIndex = findMatchingParenthesisIndex(text, nameEnd);
          const inner = text.slice(nameEnd + 1, closeIndex);
          if (name === 'where') {
            // :where() contributes zero specificity
          } else if (name === 'is' || name === 'not' || name === 'has' || name === 'matches') {
            const innerMax = maxSelectorSpecificity(inner);
            specificity[0] += innerMax[0];
            specificity[1] += innerMax[1];
            specificity[2] += innerMax[2];
          } else {
            specificity[1]++;
          }
          index = closeIndex + 1;
        } else {
          // Legacy single-colon pseudo-elements count as pseudo-elements
          if (name === 'before' || name === 'after' || name === 'first-line' || name === 'first-letter') {
            specificity[2]++;
          } else {
            specificity[1]++;
          }
          index = nameEnd;
        }
      }
    } else if (character === '*' || character === '&') {
      // Universal selector and nesting selector add no counted specificity here
      index++;
    } else if ((/[a-zA-Z]/).test(character)) {
      specificity[2]++;
      index = skipSelectorName(text, index);
    } else {
      // Combinators and whitespace do not affect specificity
      index++;
    }
  }
  return specificity;
}

/**
 * Returns the maximum specificity tuple across a comma-separated selector list,
 * matching how a comma-separated group behaves as `:is()`.
 *
 * @param  {string} selectorList  The selector list string.
 * @return {Array}                The maximum [ids, classes, types] tuple.
 */
function maxSelectorSpecificity (selectorList) {
  let maximum = [0, 0, 0];
  for (const selector of splitSelectorListTopLevel(selectorList)) {
    const specificity = computeSpecificity(selector);
    if (compareSpecificity(specificity, maximum) > 0) {
      maximum = specificity;
    }
  }
  return maximum;
}

/**
 * Returns the strongest specificity a rule can match with, which is the highest
 * of its individual selectors.
 *
 * @param  {Array} selectors  The rule's selector strings.
 * @return {Array}            The [ids, classes, types] specificity tuple.
 */
function maximumRuleSpecificity (selectors) {
  return maxSelectorSpecificity((selectors || []).join(','));
}

/**
 * Returns the weakest specificity a rule's declarations are applied with. Every
 * selector of a top-level rule applies the same declarations under its own
 * specificity, so the weakest selector decides whether another rule is able to
 * override the rule as a whole.
 *
 * @param  {Array} selectors  The rule's selector strings.
 * @return {Array}            The [ids, classes, types] specificity tuple.
 */
function minimumRuleSpecificity (selectors) {
  let minimum = null;
  for (const selector of splitSelectorListTopLevel((selectors || []).join(','))) {
    const specificity = computeSpecificity(selector);
    if (!minimum || compareSpecificity(specificity, minimum) < 0) {
      minimum = specificity;
    }
  }
  return minimum || [0, 0, 0];
}

/**
 * Adds two specificity tuples together, which is how a nested selector combines
 * with the parent selector it only ever matches through.
 *
 * @param  {Array} first   The first [ids, classes, types] tuple.
 * @param  {Array} second  The second [ids, classes, types] tuple.
 * @return {Array}         The summed specificity tuple.
 */
function addSpecificity (first, second) {
  return [
    first[0] + second[0],
    first[1] + second[1],
    first[2] + second[2]
  ];
}

/**
 * Builds a normalized signature of a rule's declaration body, or null when the
 * rule contains anything other than plain declarations (e.g. nested rules).
 *
 * @param  {object}      rule  The AST rule node.
 * @return {string|null}       The sorted "property:value" signature, or null.
 */
function nestedRuleBodySignature (rule) {
  const declarations = (rule.declarations || []).filter((declaration) => {
    return declaration.type !== 'whitespace' && declaration.type !== 'comment';
  });
  if (declarations.length === 0) {
    return null;
  }
  const isAllPlainDeclarations = declarations.every((declaration) => {
    return declaration.type === 'declaration' && declaration.property;
  });
  if (!isAllPlainDeclarations) {
    return null;
  }
  return declarations
    .map((declaration) => {
      return declaration.property + ':' + (declaration.value || '').trim();
    })
    .sort()
    .join(';');
}

/**
 * Determines whether two nested rules can be merged into a shared selector list.
 * They must have identical declaration bodies and the same specificity level,
 * since comma-separated nested selectors share the highest specificity of the
 * group (like `:is()`).
 *
 * @param  {object}  first   The first nested rule.
 * @param  {object}  second  The second nested rule.
 * @return {boolean}         Whether the two nested rules may be merged.
 */
function nestedRulesMergeable (first, second) {
  if (!first.selectors?.length || !second.selectors?.length) {
    return false;
  }
  const firstSignature = nestedRuleBodySignature(first);
  if (firstSignature === null || firstSignature !== nestedRuleBodySignature(second)) {
    return false;
  }
  const firstSpecificity = maxSelectorSpecificity(first.selectors.join(','));
  const secondSpecificity = maxSelectorSpecificity(second.selectors.join(','));
  return compareSpecificity(firstSpecificity, secondSpecificity) === 0;
}

/**
 * Recursively merges consecutive nested rules within a declaration list when
 * they share identical bodies and specificity, combining their selector lists.
 *
 * @param  {Array} declarations  The declaration/nested-rule entries of a parent rule.
 * @return {Array}               The declaration list with mergeable nested rules combined.
 */
function mergeConsecutiveNestedRules (declarations) {
  const recursed = declarations.map((declaration) => {
    if (declaration.type === 'rule' && declaration.declarations) {
      return { ...declaration, declarations: mergeConsecutiveNestedRules(declaration.declarations) };
    }
    return declaration;
  });

  const result = [];
  for (const declaration of recursed) {
    const previous = result[result.length - 1];
    if (
      declaration.type === 'rule' &&
      previous &&
      previous.type === 'rule' &&
      nestedRulesMergeable(previous, declaration)
    ) {
      result[result.length - 1] = {
        ...previous,
        selectors: [...previous.selectors, ...declaration.selectors]
      };
      continue;
    }
    result.push(declaration);
  }
  return result;
}

/**
 * Merges mergeable nested rules within every rule's body across the stylesheet,
 * recursing into `@media` and `@layer` blocks. Top-level rules are not merged
 * here, since only nested (comma-grouped) selectors share specificity.
 *
 * @param  {Array} rules  The AST rule nodes to process.
 * @return {Array}        The rules with mergeable nested rules combined.
 */
function mergeIdenticalNestedRules (rules) {
  for (const rule of rules) {
    if (rule.type === 'rule' && rule.declarations) {
      rule.declarations = mergeConsecutiveNestedRules(rule.declarations);
    } else if ((rule.type === 'media' || rule.type === 'layer') && rule.rules) {
      rule.rules = mergeIdenticalNestedRules(rule.rules);
    }
  }
  return rules;
}

/**
 * The property that rewrites every other standard property, and so conflicts
 * with any declaration it is ordered against.
 *
 * @type {string}
 */
const RESET_ALL_PROPERTY = 'all';

/**
 * Index key standing for "declares anything at all", used to order a rule that
 * sets `all` against every other declaration.
 *
 * @type {symbol}
 */
const ANY_PROPERTY = Symbol('any property');

/**
 * The leaf properties each declared property can write to, computed on first
 * use. The shorthand tables never change, so a property always expands the same
 * way.
 *
 * @type {Map<string, Set<string>>}
 */
const overridablePropertiesByProperty = new Map();

/**
 * Expands a declared property into every leaf longhand it can write to,
 * including the extras a shorthand resets beyond its own longhands. Two
 * declarations can only override one another when these sets intersect, which
 * is what makes `margin` conflict with `margin-top` but not with `color`.
 *
 * @param  {string} property  The declared property name.
 * @return {Set}              The leaf property names the declaration writes to.
 */
function expandToOverridableProperties (property) {
  const cachedProperties = overridablePropertiesByProperty.get(property);
  if (cachedProperties) {
    return cachedProperties;
  }
  const overridableProperties = new Set(expandToLeafProperties(property));
  for (const resetProperty of getOverridesOf(property)) {
    for (const leafProperty of expandToLeafProperties(resetProperty)) {
      overridableProperties.add(leafProperty);
    }
  }
  overridablePropertiesByProperty.set(property, overridableProperties);
  return overridableProperties;
}

/**
 * Whether a property name is a custom property, which shorthands and `all`
 * never reset.
 *
 * @param  {string}  property  The leaf property name.
 * @return {boolean}           True when the property is a custom property.
 */
function isCustomProperty (property) {
  return property.startsWith('--');
}

/**
 * @typedef  {object}  RuleWriteProfile
 * @property {Map}     specificityByProperty   The strongest specificity each leaf property is written with.
 * @property {Array}   weakestSpecificity      The weakest specificity the rule's declarations are applied with.
 * @property {Array}   strongestSpecificity    The strongest specificity anything in the rule is written with.
 * @property {boolean} writesStandardProperty  Whether the rule writes any property other than a custom property.
 */

/**
 * Notes in a profile that a leaf property is written with a specificity,
 * keeping only the strongest specificity seen for it.
 *
 * @param {RuleWriteProfile} profile      The profile to extend.
 * @param {string}           property     The leaf property name.
 * @param {Array}            specificity  The specificity the property is written with.
 */
function addWrittenProperty (profile, property, specificity) {
  const strongestSoFar = profile.specificityByProperty.get(property);
  if (!strongestSoFar || compareSpecificity(specificity, strongestSoFar) > 0) {
    profile.specificityByProperty.set(property, specificity);
  }
  if (compareSpecificity(specificity, profile.strongestSpecificity) > 0) {
    profile.strongestSpecificity = specificity;
  }
  profile.writesStandardProperty = profile.writesStandardProperty || !isCustomProperty(property);
}

/**
 * Adds every leaf property a rule's declarations write to into a profile,
 * descending into nested rules, whose declarations only ever match through the
 * parent and so carry the specificity of both selectors.
 *
 * @param {RuleWriteProfile} profile      The profile to extend.
 * @param {object}           rule         The AST rule node to read declarations from.
 * @param {Array}            specificity  The specificity the rule's own declarations apply with.
 */
function addWrittenProperties (profile, rule, specificity) {
  for (const declaration of rule.declarations || []) {
    if (declaration.type === 'rule') {
      const nestedSpecificity = addSpecificity(specificity, maximumRuleSpecificity(declaration.selectors));
      addWrittenProperties(profile, declaration, nestedSpecificity);
    } else if (declaration.type === 'declaration' && declaration.property) {
      for (const leafProperty of expandToOverridableProperties(declaration.property)) {
        addWrittenProperty(profile, leafProperty, specificity);
      }
    }
  }
}

/**
 * Summarizes which properties a rule writes to and how strongly, which is
 * everything the cascade needs to know about a rule to decide whether it may be
 * reordered against another one.
 *
 * @param  {object}           rule  The AST rule node.
 * @return {RuleWriteProfile}       The rule's write profile.
 */
function buildRuleWriteProfile (rule) {
  const profile = {
    specificityByProperty: new Map(),
    weakestSpecificity: minimumRuleSpecificity(rule.selectors),
    strongestSpecificity: [0, 0, 0],
    writesStandardProperty: false
  };
  addWrittenProperties(profile, rule, maximumRuleSpecificity(rule.selectors));
  return profile;
}

/**
 * Folds one rule's writes into another's profile, which is how a profile stays
 * current after a merge appends declarations to a rule. Both rules share the
 * same selectors, so the absorbed writes keep their recorded specificity.
 *
 * @param {RuleWriteProfile} profile         The profile of the rule that grew.
 * @param {RuleWriteProfile} absorbedWrites  The profile of the rule whose declarations were appended.
 */
function absorbWriteProfile (profile, absorbedWrites) {
  for (const [property, specificity] of absorbedWrites.specificityByProperty) {
    addWrittenProperty(profile, property, specificity);
  }
}

/**
 * Tracks which properties each rule writes to and where it sits, so that a
 * merge can ask whether anything after a position could override the
 * declarations it wants to move, instead of rescanning the stylesheet once per
 * merge.
 *
 * Entries for a property are appended in increasing position order, and each
 * new entry discards the earlier ones it dominates, since a declaration that is
 * both later and at least as specific blocks everything a weaker, earlier one
 * would. What remains is a list whose specificity strictly decreases as
 * position grows, so the first entry past a queried position is also the
 * strongest one past it.
 *
 * @return {object} An index exposing `recordRule` and `blocksRelocation`.
 */
function createOverrideIndex () {
  const entriesByProperty = new Map();
  const profileByRule = new Map();

  /**
   * Records that a property is written at a position with a given specificity.
   *
   * @param {string|symbol} property     The leaf property name, or an index key.
   * @param {number}        position     The slot the writing rule occupies.
   * @param {Array}         specificity  The specificity the declaration applies with.
   */
  function addEntry (property, position, specificity) {
    let entries = entriesByProperty.get(property);
    if (!entries) {
      entries = [];
      entriesByProperty.set(property, entries);
    }
    while (entries.length && compareSpecificity(entries[entries.length - 1].specificity, specificity) <= 0) {
      entries.pop();
    }
    entries.push({ position, specificity });
  }

  /**
   * Whether some rule after a position writes to a property with at least a
   * given specificity, and could therefore win the cascade against it.
   *
   * @param  {string|symbol} property     The leaf property name, or an index key.
   * @param  {number}        position     The position to search after.
   * @param  {Array}         specificity  The specificity to compare against.
   * @return {boolean}                    True when a later rule could override the property.
   */
  function hasStrongerEntryAfter (property, position, specificity) {
    const entries = entriesByProperty.get(property);
    if (!entries) {
      return false;
    }
    let low = 0;
    let high = entries.length;
    while (low < high) {
      const middle = Math.floor((low + high) / 2);
      if (entries[middle].position > position) {
        high = middle;
      } else {
        low = middle + 1;
      }
    }
    if (low === entries.length) {
      return false;
    }
    return compareSpecificity(entries[low].specificity, specificity) >= 0;
  }

  /**
   * Returns a rule's write profile, building it the first time it is needed.
   * Rules only ever grow here, by absorbing another rule's declarations, so a
   * profile stays valid for as long as the merge pass runs.
   *
   * @param  {object}           rule  The AST rule node.
   * @return {RuleWriteProfile}       The rule's write profile.
   */
  function getWriteProfile (rule) {
    let profile = profileByRule.get(rule);
    if (!profile) {
      profile = buildRuleWriteProfile(rule);
      profileByRule.set(rule, profile);
    }
    return profile;
  }

  /**
   * Records every property a rule writes to at the position it occupies.
   *
   * @param {object} rule      The AST rule node.
   * @param {number} position  The slot the rule occupies.
   */
  function recordRule (rule, position) {
    const profile = getWriteProfile(rule);
    if (!profile.specificityByProperty.size) {
      return;
    }
    for (const [property, specificity] of profile.specificityByProperty) {
      addEntry(property, position, specificity);
    }
    addEntry(ANY_PROPERTY, position, profile.strongestSpecificity);
  }

  /**
   * Folds a rule's writes into the rule that just absorbed its declarations, so
   * the grown rule is treated as writing to both sets of properties.
   *
   * @param {object} rule          The rule that grew.
   * @param {object} absorbedRule  The rule whose declarations were appended to it.
   */
  function absorbRule (rule, absorbedRule) {
    absorbWriteProfile(getWriteProfile(rule), getWriteProfile(absorbedRule));
  }

  /**
   * Whether moving a rule's declarations past everything recorded after a
   * position would change which declaration wins the cascade. Only a rule that
   * is strictly less specific is guaranteed to lose either way, so anything of
   * equal or greater specificity that writes to the same properties blocks the
   * move.
   *
   * @param  {object}  movingRule     The rule whose declarations would relocate.
   * @param  {number}  afterPosition  The position the declarations would move across.
   * @return {boolean}                True when the relocation is unsafe.
   */
  function blocksRelocation (movingRule, afterPosition) {
    const profile = getWriteProfile(movingRule);
    const specificity = profile.weakestSpecificity;
    for (const property of profile.specificityByProperty.keys()) {
      if (hasStrongerEntryAfter(property, afterPosition, specificity)) {
        return true;
      }
    }
    if (profile.writesStandardProperty && hasStrongerEntryAfter(RESET_ALL_PROPERTY, afterPosition, specificity)) {
      return true;
    }
    return (
      profile.specificityByProperty.has(RESET_ALL_PROPERTY) &&
      hasStrongerEntryAfter(ANY_PROPERTY, afterPosition, specificity)
    );
  }

  return {
    absorbRule,
    blocksRelocation,
    recordRule
  };
}

/**
 * Builds the key two rules must share to be considered the same selector.
 *
 * @param  {object} rule  The AST rule node.
 * @return {string}       The normalized, order independent selector key.
 */
function buildSelectorKey (rule) {
  if (!rule.selectors) {
    return '';
  }
  return rule.selectors
    .map((selector) => {
      return normalizeSelector(selector);
    })
    .sort()
    .join(',');
}

/**
 * Placement for a merged rule whose combined declarations belong where the
 * later of the two rules was, because the earlier declarations moved down.
 *
 * @type {string}
 */
const MERGE_AT_LATER_RULE = 'later';

/**
 * Placement for a merged rule whose combined declarations belong where the
 * earlier of the two rules was, because the later declarations moved up.
 *
 * @type {string}
 */
const MERGE_AT_EARLIER_RULE = 'earlier';

/**
 * Decides where two rules with the same selector can be combined. Merging them
 * always makes one set of declarations cross whatever separates the two rules,
 * which can flip a conflict the crossing declarations used to win or lose, so
 * the merged rule goes wherever the set that moved keeps its old standing.
 * Nothing separates adjacent rules, so those always merge.
 *
 * @param  {object}      overrideIndex    The index of what each position writes to.
 * @param  {object}      earlierRule      The first of the two rules with this selector.
 * @param  {object}      laterRule        The second of the two rules with this selector.
 * @param  {number}      earlierPosition  The slot the earlier rule occupies.
 * @param  {number}      laterPosition    The slot the later rule would occupy.
 * @return {string|null}                  Where to place the merged rule, or null when merging is unsafe.
 */
function chooseMergePlacement (overrideIndex, earlierRule, laterRule, earlierPosition, laterPosition) {
  const rulesAreAdjacent = earlierPosition === laterPosition - 1;
  if (rulesAreAdjacent || !overrideIndex.blocksRelocation(earlierRule, earlierPosition)) {
    return MERGE_AT_LATER_RULE;
  }
  if (!overrideIndex.blocksRelocation(laterRule, earlierPosition)) {
    return MERGE_AT_EARLIER_RULE;
  }
  return null;
}

/**
 * Merges rules with identical normalized selectors by combining their declarations, as long as `chooseMergePlacement` finds a spot for the combined rule that the cascade reads the same way. Non-rule entries that affect the cascade (like `@media`) break the merge window, while comments do not, since comments never influence how declarations apply.
 *
 * @param  {Array} rules  The AST rule nodes to merge.
 * @return {Array}        A new array of rules with same-selector rules combined.
 */
function mergeSelectorRules (rules) {
  // A rule merged at the later of the two positions moves to the end of the
  // output. Its old slot is emptied instead of spliced out so that every
  // recorded position stays valid, and the position map locates that slot
  // without searching the output.
  const slots = [];
  const positionByRule = new Map();
  const selectorMap = new Map();
  const overrideIndex = createOverrideIndex();
  for (const rule of rules) {
    if (rule.type === 'whitespace') {
      continue;
    }
    if (rule.type !== 'rule') {
      slots.push(rule);
      if (rule.type !== 'comment') {
        selectorMap.clear();
        positionByRule.clear();
      }
      continue;
    }
    const selectorKey = buildSelectorKey(rule);
    const existingRule = selectorKey && selectorMap.get(selectorKey);
    if (existingRule) {
      const existingPosition = positionByRule.get(existingRule);
      const mergedPosition = slots.length;
      const placement = chooseMergePlacement(overrideIndex, existingRule, rule, existingPosition, mergedPosition);
      if (placement) {
        existingRule.declarations.push(...(rule.declarations || []));
        overrideIndex.absorbRule(existingRule, rule);
        if (placement === MERGE_AT_LATER_RULE) {
          slots[existingPosition] = null;
          positionByRule.set(existingRule, mergedPosition);
          slots.push(existingRule);
          overrideIndex.recordRule(existingRule, mergedPosition);
        } else {
          // The merged declarations now live at the earlier slot, but they are
          // recorded at the later one, since the index is only ever appended
          // to. Reading them as later than they are can only hold back a
          // further merge, never allow an unsafe one.
          overrideIndex.recordRule(rule, mergedPosition);
        }
        continue;
      }
    }
    selectorMap.set(selectorKey, rule);
    positionByRule.set(rule, slots.length);
    overrideIndex.recordRule(rule, slots.length);
    slots.push(rule);
  }
  return slots.filter((slot) => {
    return slot !== null;
  });
}

/**
 * Merges `@layer` blocks with the same name by combining their child rules, deduplicates layer statements, and merges selector rules within each block.
 *
 * @param  {Array}                  rules               The AST rule nodes to process.
 * @param  {function(Array): Array} mergeSelectorRules  Callback to merge selector rules within each layer block.
 * @return {Array}                                      A new array of rules with same-name `@layer` blocks combined.
 */
function mergeLayerRules (rules, mergeSelectorRules) {
  const layerBlockMap = new Map();
  const layerStatementSeen = new Set();
  const result = [];
  for (const rule of rules) {
    if (rule.type === 'layer') {
      const layerName = normalizeLayerNames(rule.layer);
      if (rule.rules && rule.rules.length > 0) {
        if (layerName && layerBlockMap.has(layerName)) {
          layerBlockMap.get(layerName).rules.push(...rule.rules);
        } else {
          if (layerName) {
            layerBlockMap.set(layerName, rule);
          }
          result.push(rule);
        }
      } else {
        if (!layerName || !layerStatementSeen.has(layerName)) {
          if (layerName) {
            layerStatementSeen.add(layerName);
          }
          result.push(rule);
        }
      }
    } else {
      result.push(rule);
    }
  }
  for (const rule of result) {
    if (rule.type === 'layer' && rule.rules && rule.rules.length) {
      rule.rules = mergeSelectorRules(rule.rules);
    }
  }
  return result;
}

/**
 * Normalizes a selector string for consistent comparison by trimming
 * and collapsing internal whitespace.
 *
 * @param  {string} selector  The raw selector string.
 * @return {string}           The normalized selector.
 */
function normalizeSelector (selector) {
  return selector
    .trim()
    .replace(/\s+/g, ' ')
    // Convert double-colon ::before/::after to single-colon legacy form
    .replace(/::before\b/g, ':before')
    .replace(/::after\b/g, ':after');
}

/**
 * Indexes, for every normalized selector in the stylesheet, the last rule that
 * declares each property under it. Comparing that index against a rule's own
 * position answers "is this selector's property overridden later" in constant
 * time, instead of rescanning and renormalizing every following rule.
 *
 * @param  {Array} rules  The flat list of AST rule nodes.
 * @return {Map}          Map of normalized selector to a map of property name to its last declaring rule index.
 */
function indexLastDeclaringRuleBySelector (rules) {
  const lastRuleIndexBySelector = new Map();
  rules.forEach((rule, ruleIndex) => {
    if (rule.type !== 'rule' || !rule.selectors) {
      return;
    }
    const declaredProperties = (rule.declarations || []).filter((declaration) => {
      return declaration.type === 'declaration';
    }).map((declaration) => {
      return declaration.property;
    });
    if (declaredProperties.length === 0) {
      return;
    }
    for (const selector of rule.selectors) {
      const normalizedSelector = normalizeSelector(selector);
      let lastRuleIndexByProperty = lastRuleIndexBySelector.get(normalizedSelector);
      if (!lastRuleIndexByProperty) {
        lastRuleIndexByProperty = new Map();
        lastRuleIndexBySelector.set(normalizedSelector, lastRuleIndexByProperty);
      }
      for (const property of declaredProperties) {
        lastRuleIndexByProperty.set(property, ruleIndex);
      }
    }
  });
  return lastRuleIndexBySelector;
}

/**
 * Checks whether a given selector has a specific property overridden
 * by any later rule in the stylesheet. A property is considered
 * overridden if a subsequent rule contains that selector (as its only
 * selector or among its selectors) and declares the same property.
 *
 * @param  {Map}     lastRuleIndexBySelector  The index built by `indexLastDeclaringRuleBySelector`.
 * @param  {number}  startIndex               The index of the current rule (search starts after this).
 * @param  {string}  selector                 The normalized selector to check.
 * @param  {string}  property                 The CSS property name to check.
 * @return {boolean}                          True if a later rule overrides this selector+property.
 */
function isSelectorPropertyOverriddenLater (lastRuleIndexBySelector, startIndex, selector, property) {
  const lastRuleIndex = lastRuleIndexBySelector.get(selector)?.get(property);
  return lastRuleIndex !== undefined && lastRuleIndex > startIndex;
}

/**
 * Determines whether a declaration carries a trailing `!important` flag.
 *
 * @param  {object}  declaration  The AST declaration node.
 * @return {boolean}              True when the declaration is important.
 */
function isImportantDeclaration (declaration) {
  // A trailing !important suffix on the raw declaration value
  return /!\s*important\s*$/i.test(declaration.rawValue || declaration.value || '');
}

/**
 * Indexes, for every normalized selector in the stylesheet, the last rule that
 * covers each leaf property under it, where coverage follows the same "writes
 * to" model as `expandToOverridableProperties` (a later `border` declaration
 * on the same selector also overrides an earlier `border-color` on it), along
 * with whether that covering declaration is important. A last-covering entry
 * is consulted to answer "is every declaration this selector still gets from
 * the rule at position X re-declared later".
 *
 * @param  {Array} rules  The flat list of AST rule nodes.
 * @return {Map}          Map of normalized selector to a map of covered leaf property name to `{ ruleIndex, important }`.
 */
function indexFinalCoveringRuleBySelector (rules) {
  const coverageBySelector = new Map();
  rules.forEach((rule, ruleIndex) => {
    if (rule.type !== 'rule' || !rule.selectors?.length) {
      return;
    }
    const declarations = (rule.declarations || []).filter((declaration) => {
      return declaration.type === 'declaration' && declaration.property;
    });
    if (!declarations.length) {
      return;
    }
    for (const selector of rule.selectors) {
      const normalizedSelector = normalizeSelector(selector);
      let coverageByProperty = coverageBySelector.get(normalizedSelector);
      if (!coverageByProperty) {
        coverageByProperty = new Map();
        coverageBySelector.set(normalizedSelector, coverageByProperty);
      }
      for (const declaration of declarations) {
        const important = isImportantDeclaration(declaration);
        for (const leafProperty of expandToOverridableProperties(declaration.property)) {
          coverageByProperty.set(leafProperty, { important, ruleIndex });
        }
      }
    }
  });
  return coverageBySelector;
}

/**
 * Determines whether a later rule overrides every leaf property an earlier
 * declaration writes to for the same selector, including via shorthand
 * coverage, with an important earlier write requiring an important later
 * write to beat it.
 *
 * @param  {Map}     coverageByProperty      The leaf property coverage index for the selector.
 * @param  {object}  declaration             The earlier declaration to test.
 * @param  {number}  ruleIndex               The position of the rule holding the declaration.
 * @param  {boolean} declarationIsImportant  Whether the earlier write of this property is important.
 * @return {boolean}                         True when the declaration is conclusively overridden later.
 */
function isDeclarationOverriddenLater (coverageByProperty, declaration, ruleIndex, declarationIsImportant) {
  for (const leafProperty of expandToOverridableProperties(declaration.property)) {
    const coverage = coverageByProperty.get(leafProperty);
    if (!coverage || coverage.ruleIndex <= ruleIndex) {
      return false;
    }
    // An important declaration outlives a later non-important one
    if (declarationIsImportant && !coverage.important) {
      return false;
    }
  }
  return true;
}

/**
 * Removes a selector from a multi-selector rule's list when every declaration
 * the rule would still give that selector is overridden by a later rule that
 * contains the same selector. For example, if `h1,h2{color:red}` is followed
 * by `h2{color:tan}`, the `h2` entry contributes nothing and can be dropped,
 * leaving `h1{color:red}`. If the list empties out entirely, the rule is
 * stripped of declarations so `removeEmptyRules` discards it.
 *
 * @param  {Array} rules  The flat list of AST rule nodes.
 * @return {Array}        The rules with fully overridden selectors removed from their lists.
 */
function removeFullyOverriddenSelectors (rules) {
  // Pruning a selector only ever shrinks lists: a covering entry that wins
  // today is supplied by a later rule, and pruning earlier rules never moves
  // coverage forward, so a single index built up front stays accurate.
  const coverageBySelector = indexFinalCoveringRuleBySelector(rules);

  for (let ruleIndex = 0; ruleIndex < rules.length; ruleIndex++) {
    const rule = rules[ruleIndex];
    if (rule.type !== 'rule' || !rule.selectors || rule.selectors.length < 2) {
      continue;
    }
    const entries = rule.declarations || [];
    // Removing a selector would also un-scope nested rules, which may depend
    // on it, so only rules made purely of declarations qualify
    const hasNestedContent = entries.some((entry) => {
      return entry.type !== 'declaration' && entry.type !== 'whitespace' && entry.type !== 'comment';
    });
    if (hasNestedContent) {
      continue;
    }
    const declarations = entries.filter((entry) => {
      return entry.type === 'declaration' && entry.property;
    });
    if (!declarations.length) {
      continue;
    }
    // Within a rule, any important declaration of a property makes the rule's
    // write of that property important (a conservative stand-in for tracking
    // which of several same-property declarations survives inside the rule)
    const importantByProperty = new Map();
    for (const declaration of declarations) {
      if (isImportantDeclaration(declaration)) {
        importantByProperty.set(declaration.property, true);
      } else if (!importantByProperty.has(declaration.property)) {
        importantByProperty.set(declaration.property, false);
      }
    }
    const keptSelectors = rule.selectors.filter((selector) => {
      const coverageByProperty = coverageBySelector.get(normalizeSelector(selector));
      if (!coverageByProperty) {
        return true;
      }
      // Keep the selector while at least one declaration is not conclusively
      // overridden for it by a later rule
      return declarations.some((declaration) => {
        return !isDeclarationOverriddenLater(
          coverageByProperty,
          declaration,
          ruleIndex,
          importantByProperty.get(declaration.property)
        );
      });
    });
    if (keptSelectors.length !== rule.selectors.length) {
      if (!keptSelectors.length) {
        rule.declarations = entries.filter((entry) => {
          return entry.type !== 'declaration';
        });
      }
      rule.selectors = keptSelectors;
    }
  }
  return rules;
}

/**
 * Removes properties from multi-selector rules when every selector in
 * the rule has that property overridden by a later rule. For example,
 * if `h1,h2{color:red}` is followed by `h1{color:blue}` and
 * `h2{color:green}`, the `color` in the first rule is redundant and
 * can be removed. If all properties are removed, the empty rule will
 * be cleaned up by `removeEmptyRules`.
 *
 * @param  {Array} rules  The flat list of AST rule nodes.
 * @return {Array}        The rules with overridden multi-selector properties removed.
 */
function removeOverriddenMultiSelectorProperties (rules) {
  // Only rules that follow the one being pruned are ever consulted, and pruning
  // never adds a declaration, so a single index built up front stays accurate.
  const lastRuleIndexBySelector = indexLastDeclaringRuleBySelector(rules);

  for (let ruleIndex = 0; ruleIndex < rules.length; ruleIndex++) {
    const rule = rules[ruleIndex];
    if (rule.type !== 'rule' || !rule.selectors || rule.selectors.length < 2) {
      continue;
    }
    const normalizedSelectors = rule.selectors.map(normalizeSelector);
    const declarations = (rule.declarations || []).filter((declaration) => {
      return declaration.type === 'declaration';
    });
    if (declarations.length === 0) {
      continue;
    }

    // For each property in this multi-selector rule, check if ALL selectors
    // get that property overridden in later rules
    const propertiesToRemove = new Set();
    for (const declaration of declarations) {
      const property = declaration.property;
      const allSelectorsOverridden = normalizedSelectors.every((selector) => {
        return isSelectorPropertyOverriddenLater(lastRuleIndexBySelector, ruleIndex, selector, property);
      });
      if (allSelectorsOverridden) {
        propertiesToRemove.add(property);
      }
    }

    if (propertiesToRemove.size > 0) {
      rule.declarations = (rule.declarations || []).filter((declaration) => {
        if (declaration.type !== 'declaration') {
          return true;
        }
        return !propertiesToRemove.has(declaration.property);
      });
    }
  }
  return rules;
}

export {
  deduplicateKeyframes,
  expandPureNestedRules,
  factorCommonParents,
  mergeByDeclarations,
  mergeIdenticalNestedRules,
  mergeLayerRules,
  mergeMediaRules,
  mergeSelectorRules,
  nestFlatRules,
  removeEmptyRules,
  removeFullyOverriddenSelectors,
  removeOverriddenMultiSelectorProperties
};

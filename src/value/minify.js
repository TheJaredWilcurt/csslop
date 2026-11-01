/**
 * @file Minifies CSS declaration values by applying color conversion, math simplification, shorthand compression, and other property-specific optimizations.
 */

import { isCustomProperty } from '../utilities.js';

import { convertColorsToHex } from './color/functions.js';
import { simplifyEquivalentLightDarkFunctions } from './color/light-dark.js';
import { minifyRelativeColorSyntax } from './color/relative.js';
import {
  lowercaseHexColors,
  shortenColorValues
} from './color/shorten.js';
import { minifyGradients } from './gradients.js';
import { shortenLengthyInitialKeyword } from './initial-keywords.js';
import {
  normalizeMathFunctions,
  simplifyStandaloneCalc
} from './math/index.js';
import { keepsNumberType } from './numbers.js';
import { POSITION_AREA_SHORTHANDS } from './positions.js';
import {
  applyPropertyOptimizations,
  PUNCTUATED_COMPONENT_PROPERTIES
} from './property-optimizations.js';
import { isQuotesNoneEquivalent } from './quotes.js';
import { replaceOutsideStringsAndUrls } from './segments.js';
import { formatResolvedNumber } from './shared.js';
import {
  elideRedundantSeparators,
  shortenDimensionNumbers
} from './tokens.js';
import { optimizeUnicodeRange } from './unicode-range.js';
import {
  minifyUrls,
  protectUrlTokens,
  removeWhitespaceAfterUrlTokens,
  restoreUrlTokens
} from './urls.js';
import { normalizeWhitespaceAndQuotes } from './whitespace.js';

/**
 * Simplifies the `calc()` expressions that add a zero percentage to a
 * non-zero one, dropping the additive identity term.
 *
 * @param  {string} value  The CSS value string.
 * @return {string}        The value with zero-percent additive terms removed.
 */
function removeZeroPercentTermsFromCalc (value) {
  // Match a calc() whose contents hold no further parentheses
  return value.replace(/calc\(([^()]+)\)/gi, (match, inner) => {
    // Collapse whitespace inside calc expression
    const compactInner = inner.replace(/\s+/g, ' ').trim();
    // Extract all percentage terms from the expression
    const percentTerms = compactInner.match(/[+-]?\s*(?:\d*\.\d+|\d+)%/g) || [];
    const hasNonZeroPercent = percentTerms.some((term) => {
      return Math.abs(parseFloat(term)) > 0;
    });
    if (!hasNonZeroPercent) {
      return match;
    }
    // Remove trailing "+ 0%" and leading "0% +" additive identity terms
    return 'calc(' + compactInner.replace(/\s*\+\s*0%(?=\s*$)/g, '').replace(/^0%\s*\+\s*/g, '').trim() + ')';
  });
}

/**
 * Matches a value that is a single number with an optional unit, capturing
 * the number and the unit.
 *
 * @type {RegExp}
 */
const STANDALONE_NUMBER_PATTERN = /^([+-]?(?:\d+|\d*\.\d+))([a-z%]+)?$/i;

/**
 * Rounds a value that is a standalone number with an optional unit into the
 * character budget a number is written within. A custom property only takes
 * the rounding when it keeps the number's type, and a tiny dimension whose
 * significant digits rounding would lose keeps its exponent form instead.
 *
 * @param  {string} value     The CSS value string.
 * @param  {string} property  The CSS property name.
 * @return {string}           The rounded value, or the value unchanged when it is not a standalone number.
 */
function roundStandaloneNumber (value, property) {
  const standaloneNumber = value.match(STANDALONE_NUMBER_PATTERN);
  if (!standaloneNumber) {
    return value;
  }
  const [, rawNumber, rawUnit = ''] = standaloneNumber;
  const isCustom = isCustomProperty(property);
  const scientificValue = isCustom ? value : shortenDimensionNumbers(value, property);
  const roundedNumber = formatResolvedNumber(rawNumber);
  const losesPrecision = Number(roundedNumber) !== Number(rawNumber);
  // Preserve tiny dimensions whose significant digits would otherwise be
  // rounded away before their shorter exponent form can be considered.
  if (losesPrecision && scientificValue !== value) {
    return scientificValue;
  }
  if (!isCustom || keepsNumberType(rawNumber, roundedNumber)) {
    return roundedNumber + rawUnit;
  }
  return value;
}

/**
 * Minifies a CSS declaration's value by applying color conversion, math simplification, shorthand compression, gradient optimization, and other property-specific optimizations.
 *
 * @param  {object} declaration  The CSS declaration object with property and value fields.
 * @return {string}              The minified value string.
 */
function computeMinifiedValue (declaration) {
  if (declaration.property === 'position-area') {
    const shorthand = POSITION_AREA_SHORTHANDS[declaration.value];
    if (shorthand) {
      return shorthand;
    }
  }
  if (declaration.property === 'quotes' && isQuotesNoneEquivalent(declaration.value)) {
    return 'none';
  }
  let value = declaration.value;
  let protectedUrlState = null;

  if (typeof value === 'string') {
    value = value.trim();
    value = normalizeWhitespaceAndQuotes(value, declaration.property);
    value = minifyUrls(value);
    protectedUrlState = protectUrlTokens(value);
    value = protectedUrlState.value;

    // Instead of unconditionally removing spaces around + and - and *, handle math vs non-math
    // Collapse spaces around division operator
    value = value.replace(/ \/ /g, '/');
    // Remove whitespace around * and / operators (safe outside calc context)
    value = value.replace(/\s*([*/])\s*/g, '$1');
    value = normalizeMathFunctions(value, declaration.property, declaration.value || '');
    value = simplifyStandaloneCalc(value, declaration.property);
    value = removeZeroPercentTermsFromCalc(value);

    // Zeros and Decimals
    if (declaration.property !== 'initial-value') {
      // Strip units from zero values (0px → 0, 0em → 0, etc.) at a value boundary
      value = value.replace(/(^|\s|,|\()0(?:px|em|rem|vw|vh|cm|mm|in|pt|pc|ex|ch|vmin|vmax)(?=\s|,|$|\)|!)/g, '$10');
    }
    value = value.replace(/(^|\s|,|\()(-?)0+(\.\d+)/g, '$1$2$3'); // e.g. 0.5 -> .5, -0.5 -> -.5
    value = roundStandaloneNumber(value, declaration.property);

    value = lowercaseHexColors(value);

    if (declaration.property !== 'font' && declaration.property !== 'font-family') {
      value = convertColorsToHex(value);
      value = replaceOutsideStringsAndUrls(value, (segment) => {
        return shortenColorValues(segment);
      });
    }

    // Collapse light-dark() when both normalized branches are identical
    value = simplifyEquivalentLightDarkFunctions(value);

    // Property-specific optimizations
    value = applyPropertyOptimizations(
      value,
      declaration.property,
      protectedUrlState ? protectedUrlState.urlTokens : []
    );

    // Minify relative color syntax (identity resolution and whitespace collapsing)
    value = minifyRelativeColorSyntax(value);
  }

  // Gradient optimizations
  // Check if value contains a gradient function
  if (/gradient\(/.test(value)) {
    value = minifyGradients(value);
  }

  if (protectedUrlState) {
    value = removeWhitespaceAfterUrlTokens(value, protectedUrlState.urlTokens);
    value = restoreUrlTokens(value, protectedUrlState.urlTokens);
  }

  // Unicode range optimization: dedup, merge overlapping/adjacent, wildcard compression
  if (declaration.property === 'unicode-range') {
    value = optimizeUnicodeRange(value);
  }

  // Every earlier pass reads the value with its component separators in place,
  // so the ones that turned out to be redundant are only dropped at the end.
  const elidesRedundantSeparators = (
    typeof value === 'string' &&
    !isCustomProperty(declaration.property)
  );
  if (elidesRedundantSeparators) {
    value = shortenDimensionNumbers(value, declaration.property);
    // A property that punctuates its own components already had the whitespace
    // after its closing parentheses taken out, and only the separators its
    // grammar still needs put back, so those are the ones left alone here.
    const elidesAfterSelfEndingTokens = !PUNCTUATED_COMPONENT_PROPERTIES.has(declaration.property);
    value = elideRedundantSeparators(value, elidesAfterSelfEndingTokens);
  }

  return value;
}

/**
 * Memoizes minified values for the current stylesheet. Minification runs many
 * passes over the same declarations (deduplication, shorthand assembly,
 * CSS-wide keyword hoisting, stringification), and the result only depends on
 * the declaration's property, its value, and whether it is an assembled
 * shorthand, so each distinct
 * property/value pair is minified once per stylesheet.
 *
 * Values are filed under their property first, and assembled shorthands are
 * kept apart from authored declarations, so a lookup reuses the property and
 * value strings as they are instead of building a combined key on every call.
 *
 * @type {Map<string, Map<string, string>>}
 */
const minifiedValuesByProperty = new Map();

/**
 * The memoized values of shorthands the minifier assembled itself, filed the
 * same way as `minifiedValuesByProperty`.
 *
 * @type {Map<string, Map<string, string>>}
 */
const assembledMinifiedValuesByProperty = new Map();

/**
 * Discards every memoized value. The minifier calls this at the start of each
 * stylesheet, since the active `@charset` can change how a value minifies and
 * the cache should not outlive the pass that filled it.
 */
function clearMinifiedValueCache () {
  minifiedValuesByProperty.clear();
  assembledMinifiedValuesByProperty.clear();
}

/**
 * Finds the memoized values for a declaration's property, creating the empty
 * collection the first time the property is seen.
 *
 * @param  {object}              declaration  The CSS declaration object.
 * @return {Map<string, string>}              Map of value to its minified form for that property.
 */
function getMinifiedValuesForProperty (declaration) {
  const valuesByProperty = declaration.isAssembledShorthand ?
    assembledMinifiedValuesByProperty :
    minifiedValuesByProperty;
  let minifiedValues = valuesByProperty.get(declaration.property);
  if (!minifiedValues) {
    minifiedValues = new Map();
    valuesByProperty.set(declaration.property, minifiedValues);
  }
  return minifiedValues;
}

/**
 * Minifies a CSS declaration's value, reusing the memoized result when the same
 * property and value has already been minified during this pass.
 *
 * @param  {object} declaration  The CSS declaration object with property and value fields.
 * @return {string}              The minified value string.
 */
function minifyValue (declaration) {
  // Only string values have a stable, collision-free key; anything else is rare
  // enough that minifying it again costs less than encoding its type.
  if (typeof declaration.value !== 'string') {
    return computeMinifiedValue(declaration);
  }
  const minifiedValues = getMinifiedValuesForProperty(declaration);
  const cachedValue = minifiedValues.get(declaration.value);
  if (cachedValue !== undefined) {
    return cachedValue;
  }
  const minifiedValue = computeMinifiedValue(declaration);
  minifiedValues.set(declaration.value, minifiedValue);
  return minifiedValue;
}

/**
 * Minifies a declaration's value for output, rewriting its initial keyword to
 * the shorter global `initial` keyword after shorthand assembly.
 *
 * @param  {object} declaration  The CSS declaration object with property and value fields.
 * @return {string}              The minified value with its initial keyword shortened to `initial` when that saves bytes.
 */
function minifyValueForOutput (declaration) {
  const value = minifyValue(declaration);
  // Custom properties hold an arbitrary token stream that JavaScript can read
  // back, so their keywords are left exactly as written.
  if (isCustomProperty(declaration.property)) {
    return value;
  }
  return shortenLengthyInitialKeyword(value, declaration.property);
}

export {
  clearMinifiedValueCache,
  minifyValue,
  minifyValueForOutput
};

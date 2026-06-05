/**
 * @file Deduplicates, merges, and optimizes CSS declarations by collapsing longhand properties into shorthands and removing overridden values.
 */

import { minifyValue } from '../value/minify.js';
import { collapseShorthandParts } from '../value/shared.js';

import {
  shorthandMap,
  shorthandOverrideMap
} from './config.js';

/**
 * Reorders declarations so that shorthands appear before any related longhands they would override, preventing cascade issues in the minified output.
 *
 * @param  {Array} declarations  The array of CSS declaration objects to reorder.
 * @return {Array}               A new array with declarations in the corrected order.
 */
function orderDeclarations (declarations) {
  const ordered = [...declarations];
  const moveBefore = (property, beforeProperty) => {
    const fromIndex = ordered.findIndex((declaration) => {
      return declaration?.property === property;
    });
    const toIndex = ordered.findIndex((declaration) => {
      return declaration?.property === beforeProperty;
    });
    if (fromIndex === -1 || toIndex === -1 || fromIndex < toIndex) {
      return;
    }
    const [item] = ordered.splice(fromIndex, 1);
    ordered.splice(toIndex, 0, item);
  };

  moveBefore('border', 'border-image');
  moveBefore('font', 'font-feature-settings');
  moveBefore('font', 'font-variant-ligatures');
  moveBefore('font', 'font-kerning');
  moveBefore('font', 'font-variation-settings');
  moveBefore('mask', 'mask-border');
  moveBefore('margin', 'margin-top');
  moveBefore('margin', 'margin-right');
  moveBefore('margin', 'margin-bottom');
  moveBefore('margin', 'margin-left');

  return ordered;
}

/**
 * Determines which longhand properties are present and eligible for merging into a given shorthand. Returns null when the required longhands for the shorthand are not all available.
 *
 * @param  {string}     shorthand              The CSS shorthand property name.
 * @param  {Array}      longhands              The expected longhand property names for this shorthand.
 * @param  {Set}        declarationProperties  The set of declaration property names currently present.
 * @return {Array|null}                        The list of longhand names to merge, or null if merging is not possible.
 */
function getMergeProps (shorthand, longhands, declarationProperties) {
  const presentLonghands = longhands.filter((longhand) => {
    return declarationProperties.has(longhand);
  });
  if (presentLonghands.length === 0) {
    return null;
  }
  if (shorthand === 'font') {
    const hasRequiredFontProps = presentLonghands.includes('font-size') && presentLonghands.includes('font-family');
    if (hasRequiredFontProps) {
      return presentLonghands;
    }
    return null;
  }
  if (shorthand === 'background') {
    const hasBackgroundProp = presentLonghands.includes('background-color') || presentLonghands.includes('background-image');
    if (hasBackgroundProp) {
      return presentLonghands;
    }
    return null;
  }
  if (shorthand === 'mask') {
    if (presentLonghands.includes('mask-image')) {
      return presentLonghands;
    }
    return null;
  }
  if (shorthand === 'border-image') {
    if (presentLonghands.includes('border-image-source')) {
      return presentLonghands;
    }
    return null;
  }
  if (shorthand === 'border') {
    const hasAllBorderParts = (
      presentLonghands.includes('border-width') &&
      presentLonghands.includes('border-style') &&
      presentLonghands.includes('border-color')
    );
    if (hasAllBorderParts) {
      return ['border-width', 'border-style', 'border-color'];
    }
    return null;
  }
  if (shorthand === 'flex') {
    const hasAllFlexParts = (
      presentLonghands.includes('flex-grow') &&
      presentLonghands.includes('flex-shrink') &&
      presentLonghands.includes('flex-basis')
    );
    if (hasAllFlexParts) {
      return ['flex-grow', 'flex-shrink', 'flex-basis'];
    }
    return null;
  }
  if (presentLonghands.length === longhands.length) {
    return longhands;
  }
  return null;
}

/**
 * Get all longhands that a shorthand would override.
 *
 * @param  {string} shorthandProperty  The CSS shorthand property name.
 * @return {Array}                     A deduplicated array of all longhand property names that the shorthand overrides, including nested longhands.
 */
function getOverriddenLonghands (shorthandProperty) {
  const direct = shorthandMap[shorthandProperty] || [];
  const overrides = shorthandOverrideMap[shorthandProperty] || [];
  const all = [...direct, ...overrides];
  for (const property of direct) {
    const nested = shorthandMap[property] || [];
    all.push(...nested);
  }
  return [...new Set(all)];
}

/**
 * Check if a value contains var() - don't merge if it does (safest approach).
 *
 * @param  {string}  value  The minified CSS value string to check.
 * @return {boolean}        True if the value contains a var() with a fallback comma.
 */
function hasVarFallback (value) {
  // Match var() containing a comma (indicating a fallback value)
  return /var\([^)]*,/.test(value);
}

/**
 * Determines whether a value containing var() references can safely be merged into a shorthand. Values with fallback commas or unregistered custom properties are not mergeable.
 *
 * @param  {string}  value    The minified CSS value string to check.
 * @param  {object}  context  The minification context with registered custom property data.
 * @return {boolean}          True if the value is safe to merge into a shorthand.
 */
function canMergeVarValue (value, context) {
  // Check if the value contains any var() reference
  const containsVar = /var\(/.test(value);
  if (!containsVar || hasVarFallback(value)) {
    return !hasVarFallback(value);
  }
  // Extract all var() references with their custom property names
  const matches = [...value.matchAll(/var\((--[A-Za-z0-9_-]+)\)/g)];
  if (!matches.length) {
    return false;
  }
  return matches.every(([, propertyName]) => {
    return context.registeredCustomProperties.has(propertyName);
  });
}

/**
 * Try to merge longhand properties into a shorthand.
 *
 * @param  {Array}       properties      The longhand property names to merge.
 * @param  {Map}         declarationMap  The CSS declaration objects to draw values from, keyed by property.
 * @param  {string}      shorthandName   The target shorthand property name.
 * @param  {object}      context         The minification context with registered custom property data.
 * @return {string|null}                 The merged shorthand value string, or null if merging is not possible.
 */
function tryMergeToShorthand (properties, declarationMap, shorthandName = '', context) {
  if (properties.length < 2) {
    return null;
  }

  const values = properties.map((property) => {
    const declaration = declarationMap.get(property);
    if (declaration) {
      return minifyValue(declaration);
    }
    return null;
  });

  // If any value is null, can't merge
  const hasNullValue = values.some((value) => {
    return value === null;
  });
  if (hasNullValue) {
    return null;
  }

  // Don't merge if any value has var() with fallback or unknown custom properties
  const hasUnmergeableVar = values.some((value) => {
    return !canMergeVarValue(value, context);
  });
  if (hasUnmergeableVar) {
    return null;
  }

  // Check if all values have the same !important status
  const importantFlags = values.map((value) => {
    return value.includes('!important');
  });
  const allImportant = importantFlags.every((flag) => {
    return flag;
  });
  const noneImportant = importantFlags.every((flag) => {
    return !flag;
  });

  // Allow mixed important flags for margin/padding/inset - merge without !important on shorthand
  // For other properties, mixed important flags are not allowed
  const allowsMixedImportant = (
    shorthandName === 'margin' ||
    shorthandName === 'padding' ||
    shorthandName === 'inset' ||
    shorthandName === 'position-try'
  );
  if (!allImportant && !noneImportant && !allowsMixedImportant) {
    return null;
  }

  const cleanValues = values.map((value) => {
    return value
      .replace('!important', '')
      .trim();
  });
  const valueMap = new Map(properties.map((property, index) => {
    return [property, cleanValues[index]];
  }));

  // For margin/padding with mixed important, don't use !important on the shorthand
  // Only use !important if ALL values have it
  const useImportant = allImportant;
  const importantSuffix = useImportant ? '!important' : '';

  if (shorthandName === 'position-try') {
    const order = valueMap.get('position-try-order');
    const fallbacks = valueMap.get('position-try-fallbacks');
    if (order === 'normal' && fallbacks) {
      return fallbacks + importantSuffix;
    }
    return null;
  }

  if (shorthandName === 'transition') {
    const transitionProperty = valueMap.get('transition-property');
    const duration = valueMap.get('transition-duration');
    const timing = valueMap.get('transition-timing-function');
    const delay = valueMap.get('transition-delay');
    if (!transitionProperty || !duration) {
      return null;
    }
    const result = [transitionProperty, duration];
    if (timing && timing !== 'ease') {
      result.push(timing);
    }
    if (delay && delay !== '0' && delay !== '0s') {
      result.push(delay);
    }
    return result.join(' ') + importantSuffix;
  }

  if (shorthandName === 'animation') {
    const animationName = valueMap.get('animation-name');
    const duration = valueMap.get('animation-duration');
    if (!animationName || !duration) {
      return null;
    }
    const result = [animationName, duration];
    const timing = valueMap.get('animation-timing-function');
    const delay = valueMap.get('animation-delay');
    const iteration = valueMap.get('animation-iteration-count');
    const direction = valueMap.get('animation-direction');
    const fillMode = valueMap.get('animation-fill-mode');
    const playState = valueMap.get('animation-play-state');
    if (timing && timing !== 'ease') {
      result.push(timing);
    }
    if (delay && delay !== '0' && delay !== '0s') {
      result.push(delay);
    }
    if (iteration && iteration !== '1') {
      result.push(iteration);
    }
    if (direction && direction !== 'normal') {
      result.push(direction);
    }
    if (fillMode && fillMode !== 'none') {
      result.push(fillMode);
    }
    if (playState && playState !== 'running') {
      result.push(playState);
    }
    return result.join(' ') + importantSuffix;
  }

  if (shorthandName === 'background') {
    const color = valueMap.get('background-color');
    const image = valueMap.get('background-image');
    const repeat = valueMap.get('background-repeat');
    const position = valueMap.get('background-position');
    const attachment = valueMap.get('background-attachment');
    const result = [];
    if (color && color !== 'transparent') {
      result.push(color);
    }
    if (image && image !== 'none') {
      result.push(image);
    }
    if (position && position !== '0 0' && position !== '0% 0%') {
      result.push(position);
    }
    if (repeat && repeat !== 'repeat') {
      result.push(repeat);
    }
    if (attachment && attachment !== 'scroll') {
      result.push(attachment);
    }
    if (!result.length) {
      return null;
    }
    return result.join(' ') + importantSuffix;
  }

  if (shorthandName === 'mask') {
    const image = valueMap.get('mask-image');
    const repeat = valueMap.get('mask-repeat');
    const size = valueMap.get('mask-size');
    if (!image) {
      return null;
    }
    let result = image;
    if (repeat) {
      result += ' ' + repeat;
    }
    if (size) {
      result += '/' + size;
    }
    return result + importantSuffix;
  }

  if (shorthandName === 'border-image') {
    const source = valueMap.get('border-image-source');
    const slice = valueMap.get('border-image-slice');
    const repeat = valueMap.get('border-image-repeat');
    if (!source) {
      return null;
    }
    const result = [source];
    if (slice) {
      result.push(slice);
    }
    if (repeat) {
      result.push(repeat);
    }
    return result.join(' ') + importantSuffix;
  }

  if (shorthandName === 'text-decoration') {
    const line = valueMap.get('text-decoration-line');
    const style = valueMap.get('text-decoration-style');
    const color = valueMap.get('text-decoration-color');
    if (!line) {
      return null;
    }
    const result = [line];
    if (style && style !== 'solid') {
      result.push(style);
    }
    if (color && color !== 'currentcolor') {
      result.push(color);
    }
    return result.join(' ') + importantSuffix;
  }

  if (shorthandName === 'columns') {
    return cleanValues.join(' ') + importantSuffix;
  }

  if (shorthandName === 'list-style') {
    const position = valueMap.get('list-style-position');
    const image = valueMap.get('list-style-image');
    const type = valueMap.get('list-style-type');
    const result = [];
    if (position && position !== 'outside') {
      result.push(position);
    }
    if (image && image !== 'none') {
      result.push(image);
    }
    if (type && type !== 'disc') {
      result.push(type);
    }
    const joined = result.join(' ') || 'inside';
    return joined + importantSuffix;
  }

  if (shorthandName === 'font') {
    const fontSize = valueMap.get('font-size');
    const fontFamily = valueMap.get('font-family');
    if (!fontSize || !fontFamily) {
      return null;
    }
    const result = [];
    const fontStyle = valueMap.get('font-style');
    const fontWeight = valueMap.get('font-weight');
    const lineHeight = valueMap.get('line-height');
    if (fontStyle && fontStyle !== 'normal') {
      result.push(fontStyle);
    }
    if (fontWeight && fontWeight !== '400' && fontWeight !== 'normal') {
      result.push(fontWeight);
    }
    if (lineHeight) {
      result.push(fontSize + '/' + lineHeight);
    } else {
      result.push(fontSize);
    }
    result.push(fontFamily);
    return result.join(' ') + importantSuffix;
  }

  if (shorthandName === 'flex') {
    const grow = valueMap.get('flex-grow');
    const shrink = valueMap.get('flex-shrink');
    const basis = valueMap.get('flex-basis');
    if (!grow || !shrink || !basis) {
      return null;
    }
    return [grow, shrink, basis].join(' ') + importantSuffix;
  }

  // Build shorthand value
  if (properties.length === 2) {
    // For 2-value shorthands (logical properties)
    if (cleanValues[0] === cleanValues[1]) {
      return cleanValues[0] + importantSuffix;
    }
    return cleanValues.join(' ') + importantSuffix;
  }

  if (properties.length === 4) {
    // For 4-value shorthands (margin, padding, inset, etc.)
    // Collapse redundant values: top right bottom left → fewer values when sides match
    return collapseShorthandParts([...cleanValues]).join(' ') + importantSuffix;
  }

  // For border shorthand (3 values: width, style, color)
  const isBorderLikeShorthand = (
    properties.length === 3 &&
    (properties.includes('border-width') || properties.includes('outline-width')) &&
    properties.some((property) => {
      // Check if one longhand ends with "-style" (e.g. border-style, outline-style)
      return /-style$/.test(property);
    }) &&
    properties.some((property) => {
      // Check if one longhand ends with "-color" (e.g. border-color, outline-color)
      return /-color$/.test(property);
    })
  );
  if (isBorderLikeShorthand) {
    return cleanValues.join(' ') + importantSuffix;
  }

  return null;
}

/**
 * Deduplicates, merges, and optimizes CSS declarations within a rule block. Removes overridden longhands, collapses longhands into shorthands, and preserves intentional fallbacks.
 *
 * @param  {Array}  declarations  The array of CSS declaration objects to process.
 * @param  {object} context       The minification context with registered custom property data.
 * @return {Array}                A new array of optimized and reordered declaration objects.
 */
function processDeclarations (declarations, context) {
  let result = [];

  for (let declaration of declarations) {
    if (declaration.type === 'rule' || declaration.type === 'media') {
      result.push(declaration);
      continue;
    }

    const propertyName = declaration.property;
    if (!propertyName) {
      continue;
    }

    let minifiedValue = minifyValue(declaration);

    let previousIndex = -1;
    for (let i = result.length - 1; i >= 0; i--) {
      if (result[i].property === propertyName) {
        previousIndex = i;
        break;
      }
    }

    // Also check if there's a prefixed version we can replace
    let prefixedIndex = -1;
    if (!propertyName.startsWith('-')) {
      for (let i = result.length - 1; i >= 0; i--) {
        const isPrefixedMatch = (
          result[i].property &&
          result[i].property.endsWith(propertyName) &&
          result[i].property.startsWith('-')
        );
        if (isPrefixedMatch) {
          prefixedIndex = i;
          break;
        }
      }
    }

    if (prefixedIndex !== -1) {
      let prefixedValue = minifyValue(result[prefixedIndex]);
      if (minifiedValue === prefixedValue) {
        result.splice(prefixedIndex, 1);
        // Re-adjust previousIndex if we removed an item before it
        if (previousIndex > prefixedIndex) {
          previousIndex--;
        }
      }
    }

    if (previousIndex !== -1) {
      const previousValue = minifyValue(result[previousIndex]);

      if (previousValue.includes('!important') && !minifiedValue.includes('!important')) {
        continue;
      }

      // Fallbacks for custom variables or older browser functions should be kept
      const currentUsesModernSyntax = (
        minifiedValue.includes('calc(') ||
        minifiedValue.includes('env(') ||
        minifiedValue.includes('var(') ||
        minifiedValue.includes('-webkit-')
      );
      const previousUsesModernSyntax = (
        previousValue.includes('calc(') ||
        previousValue.includes('env(') ||
        previousValue.includes('var(') ||
        previousValue.includes('-webkit-')
      );
      if (currentUsesModernSyntax && !previousUsesModernSyntax) {
        result.push(declaration);
        continue;
      }

      // Otherwise override previous identical property
      result.splice(previousIndex, 1);
    }

    result.push(declaration);
  }

  // Handle shorthand merging

  // First, remove longhand properties that are overridden by existing shorthands
  const propertiesToRemove = new Set();
  const firstIndexByProperty = new Map();
  for (let i = 0; i < result.length; i++) {
    const propertyName = result[i].property;
    if (propertyName && !firstIndexByProperty.has(propertyName)) {
      firstIndexByProperty.set(propertyName, i);
    }
  }
  for (let i = 0; i < result.length; i++) {
    const declaration = result[i];
    if (declaration.property && shorthandMap[declaration.property]) {
      // This is a shorthand, check if any longhands come before it
      const overridden = getOverriddenLonghands(declaration.property);
      for (const longhandProperty of overridden) {
        const longhandIndex = firstIndexByProperty.get(longhandProperty);
        if (longhandIndex !== undefined && longhandIndex < i) {
          propertiesToRemove.add(longhandProperty);
        }
      }
    }
  }

  result = result.filter((declaration) => {
    return !propertiesToRemove.has(declaration.property);
  });

  // Try to merge remaining longhands into shorthands
  let changed = true;
  while (changed) {
    changed = false;
    const mergedProperties = new Set();
    const newDeclarations = [];
    const declarationProperties = new Set();

    for (const declaration of result) {
      if (declaration.property) {
        declarationProperties.add(declaration.property);
      }
    }

    for (const [shorthand, longhands] of Object.entries(shorthandMap)) {
      const shorthandAlreadyExists = declarationProperties.has(shorthand);
      if (shorthandAlreadyExists) {
        continue;
      }

      const mergeableProperties = getMergeProps(shorthand, longhands, declarationProperties);
      if (!mergeableProperties) {
        continue;
      }
      const mergeablePropertySet = new Set(mergeableProperties);
      const relevantDeclarations = result.filter((declaration) => {
        return mergeablePropertySet.has(declaration.property);
      });
      const relevantDeclarationMap = new Map(relevantDeclarations.map((declaration) => {
        return [declaration.property, declaration];
      }));
      const mergedValue = tryMergeToShorthand(mergeableProperties, relevantDeclarationMap, shorthand, context);
      if (!mergedValue) {
        continue;
      }

      newDeclarations.push({ property: shorthand, value: mergedValue });
      const isMarginPaddingInset = (
        shorthand === 'margin' ||
        shorthand === 'padding' ||
        shorthand === 'inset'
      );
      const someAreImportant = relevantDeclarations.some((declaration) => {
        return minifyValue(declaration).includes('!important');
      });
      const allAreImportant = relevantDeclarations.every((declaration) => {
        return minifyValue(declaration).includes('!important');
      });
      const hasMixedImportant = someAreImportant && !allAreImportant;

      if (isMarginPaddingInset && hasMixedImportant) {
        for (const property of mergeableProperties) {
          const declaration = relevantDeclarationMap.get(property);
          if (declaration && !minifyValue(declaration).includes('!important')) {
            mergedProperties.add(property);
          }
        }
      } else {
        for (const property of mergeableProperties) {
          mergedProperties.add(property);
        }
      }
    }

    if (newDeclarations.length) {
      result = result.filter((declaration) => {
        return !mergedProperties.has(declaration.property);
      });
      result = [...result, ...newDeclarations];
      changed = true;
    }
  }

  return orderDeclarations(result);
}

export { processDeclarations };

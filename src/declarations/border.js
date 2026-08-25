/**
 * @file Rewrites border longhand declarations that cannot be expressed as a single `border` shorthand into the shortest valid shorthand plus override pair.
 */

import { minifyValue } from '../value/minify.js';
import { splitTopLevelComponents } from '../value/syntax.js';

import { CSS_WIDE_KEYWORDS } from './config.js';
import { collectDeclaredProperties } from './lookup.js';
import { resetsPropertyDeclaredElsewhere } from './reset-hazards.js';

const BORDER_TRIO_PROPERTIES = ['border-width', 'border-style', 'border-color'];

/**
 * Finds the index of the last declaration for a property, which is the one that
 * wins the cascade within a rule.
 *
 * @param  {Array}  declarations  The declarations to search.
 * @param  {string} property      The property name to look for.
 * @return {number}               The index of the matching declaration, or -1 when absent.
 */
function findLastDeclarationIndex (declarations, property) {
  for (let index = declarations.length - 1; index >= 0; index--) {
    if (declarations[index].property === property) {
      return index;
    }
  }
  return -1;
}

/**
 * Rewrites a `border-width` + `border-style` + `border-color` trio whose color
 * differs per edge into a `border` shorthand built from the first color, followed
 * by a `border-color` override that restores the per-edge colors. The rewrite is
 * only applied when the resulting pair is shorter than the three longhands.
 *
 * @param  {Array}  declarations  The declarations of a single rule.
 * @param  {object} context       The minification context with the stylesheet's reset properties.
 * @return {Array}                The declarations, with the trio rewritten when it is shorter.
 */
function collapseBorderTrioWithPerEdgeColor (declarations, context) {
  // The `border` shorthand also resets `border-image`, so the trio stays as it
  // is when another rule of the stylesheet relies on that value.
  if (resetsPropertyDeclaredElsewhere('border', collectDeclaredProperties(declarations), context)) {
    return declarations;
  }

  const trioIndexes = BORDER_TRIO_PROPERTIES.map((property) => {
    return findLastDeclarationIndex(declarations, property);
  });
  const hasWholeTrio = trioIndexes.every((index) => {
    return index !== -1;
  });
  if (!hasWholeTrio) {
    return declarations;
  }

  const trioValues = trioIndexes.map((index) => {
    return minifyValue(declarations[index]);
  });
  const allImportant = trioValues.every((value) => {
    return value.includes('!important');
  });
  const noneImportant = trioValues.every((value) => {
    return !value.includes('!important');
  });
  if (!allImportant && !noneImportant) {
    return declarations;
  }
  const importantSuffix = allImportant ? '!important' : '';

  const [width, style, color] = trioValues.map((value) => {
    return value.replace('!important', '').trim();
  });
  const colorComponents = splitTopLevelComponents(color);
  const isSingleComponent = (value) => {
    return splitTopLevelComponents(value).length === 1;
  };
  const canBuildShorthand = (
    isSingleComponent(width) &&
    isSingleComponent(style) &&
    colorComponents.length > 1
  );
  if (!canBuildShorthand) {
    return declarations;
  }
  const usesCssWideKeyword = [width, style, ...colorComponents].some((value) => {
    return CSS_WIDE_KEYWORDS.has(value.toLowerCase());
  });
  if (usesCssWideKeyword) {
    return declarations;
  }

  const borderValue = [width, style, colorComponents[0]].join(' ') + importantSuffix;
  const colorValue = color + importantSuffix;
  const rewrittenLength = ('border:' + borderValue + ';border-color:' + colorValue).length;
  const longhandLength = (
    'border-width:' + trioValues[0] +
    ';border-style:' + trioValues[1] +
    ';border-color:' + trioValues[2]
  ).length;
  if (rewrittenLength >= longhandLength) {
    return declarations;
  }

  const replacedIndexes = new Set(trioIndexes);
  const insertionIndex = Math.min(...trioIndexes);
  return declarations.flatMap((declaration, index) => {
    if (index === insertionIndex) {
      return [
        {
          property: 'border',
          value: borderValue,
          isAssembledShorthand: true
        },
        {
          property: 'border-color',
          value: colorValue
        }
      ];
    }
    if (replacedIndexes.has(index)) {
      return [];
    }
    return [declaration];
  });
}

export { collapseBorderTrioWithPerEdgeColor };

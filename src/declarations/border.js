/**
 * @file Rewrites border longhand declarations that cannot be expressed as a single `border` shorthand into the shortest valid shorthand plus override pair.
 */

import { minifyValue } from '../value/minify.js';
import { namedColors } from '../value/named-colors.js';
import { collapseShorthandParts } from '../value/shared.js';
import { splitTopLevelComponents } from '../value/syntax.js';

import {
  BORDER_EDGE_PROPERTIES,
  CSS_WIDE_KEYWORDS
} from './config.js';
import { collectDeclaredProperties } from './lookup.js';
import { resetsPropertyDeclaredElsewhere } from './reset-hazards.js';

const BORDER_TRIO_PROPERTIES = ['border-width', 'border-style', 'border-color'];

/**
 * The keywords that state a border line style.
 *
 * @type {Set<string>}
 */
const BORDER_STYLE_KEYWORDS = new Set([
  'none',
  'hidden',
  'dotted',
  'dashed',
  'solid',
  'double',
  'groove',
  'ridge',
  'inset',
  'outset'
]);

/**
 * The keywords that state a border line width without writing a length.
 *
 * @type {Set<string>}
 */
const BORDER_WIDTH_KEYWORDS = new Set(['thin', 'medium', 'thick']);

/**
 * The functions that resolve to a length, so a border edge component calling one
 * of them states the line width.
 *
 * @type {RegExp}
 */
const LENGTH_FUNCTION_PATTERN = /^(?:calc|min|max|clamp|round|rem|mod|abs|sign|anchor-size)\(/i;

/**
 * The functions that resolve to a color, so a border edge component calling one
 * of them states the line color.
 *
 * @type {RegExp}
 */
const COLOR_FUNCTION_PATTERN = /^(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color|color-mix|light-dark|contrast-color|device-cmyk)\(/i;

/**
 * The value that each part of a border edge takes when the edge leaves it out,
 * since an edge shorthand resets every part it does not state.
 *
 * @type {{[key: string]: string}}
 */
const INITIAL_BORDER_EDGE_PARTS = {
  'border-width': 'medium',
  'border-style': 'none',
  'border-color': 'currentcolor'
};

/**
 * Builds the `border` value that states a trio whose color differs per edge.
 * Unlike a shorthand assembled out of whole longhand values, this value is one
 * the rewrite composes: it takes a single component out of the color list rather
 * than the `border-color` value as authored. So it is minified as a written
 * value, which drops the separators CSS does not need between its components
 * and measures the value at the length it is emitted with.
 *
 * @param  {string} width       The `border-width` value.
 * @param  {string} style       The `border-style` value.
 * @param  {string} firstColor  The first component of the `border-color` value.
 * @return {string}             The minified `border` value.
 */
function buildBorderShorthandValue (width, style, firstColor) {
  return minifyValue({
    property: 'border',
    value: [width, style, firstColor].join(' ')
  });
}

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

  const borderValue = buildBorderShorthandValue(width, style, colorComponents[0]) + importantSuffix;
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
          value: borderValue
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

/**
 * Decides which part of a border edge a single component states. Every
 * component has to be recognized, because a component sorted into the wrong
 * part would change what the rule renders.
 *
 * @param  {string}      component  One component of a border edge value.
 * @return {string|null}            The trio property the component states, or null when it is unrecognized.
 */
function classifyBorderEdgeComponent (component) {
  const keyword = component.toLowerCase();
  if (BORDER_STYLE_KEYWORDS.has(keyword)) {
    return 'border-style';
  }
  // Match a number with an optional unit, which is how a length is written
  const isLength = /^[+-]?(?:\d+|\d*\.\d+)[a-z]*$/i.test(component);
  if (BORDER_WIDTH_KEYWORDS.has(keyword) || isLength || LENGTH_FUNCTION_PATTERN.test(component)) {
    return 'border-width';
  }
  const isColor = (
    keyword === 'currentcolor' ||
    component.startsWith('#') ||
    Object.hasOwn(namedColors, keyword) ||
    COLOR_FUNCTION_PATTERN.test(component)
  );
  if (isColor) {
    return 'border-color';
  }
  return null;
}

/**
 * Splits one border edge value into the width, style, and color it sets. A part
 * the edge leaves unstated is reset to its initial value by the edge shorthand,
 * so the split states that initial value in its place.
 *
 * @param  {string}      value  The value of a `border-<side>` declaration, without its importance.
 * @return {object|null}        The value each trio property takes, or null when the edge cannot be split.
 */
function splitBorderEdgeValue (value) {
  const statedProperties = new Set();
  const parts = { ...INITIAL_BORDER_EDGE_PARTS };

  for (const component of splitTopLevelComponents(value)) {
    const property = classifyBorderEdgeComponent(component);
    if (!property || statedProperties.has(property)) {
      return null;
    }
    statedProperties.add(property);
    parts[property] = component;
  }

  if (!statedProperties.size) {
    return null;
  }
  return parts;
}

/**
 * Collects the one declaration of each border edge, in top/right/bottom/left
 * order. An edge that a rule states more than once is kept as it is, since the
 * repeat is a deliberate fallback whose order the split would not preserve.
 *
 * @param  {Array}      declarations  The declarations of a single rule.
 * @return {Array|null}               The four edge declarations, or null when the rule does not state each edge exactly once.
 */
function collectBorderEdgeDeclarations (declarations) {
  const edgeDeclarations = [];
  for (const edgeProperty of BORDER_EDGE_PROPERTIES) {
    const matches = declarations.filter((declaration) => {
      return declaration.property === edgeProperty;
    });
    if (matches.length !== 1) {
      return null;
    }
    edgeDeclarations.push(matches[0]);
  }
  return edgeDeclarations;
}

/**
 * Builds the `border-width`, `border-style`, and `border-color` declarations
 * that state per side what a set of border edges stated per edge. The edges are
 * read as authored rather than minified, so that each component is still a
 * component of its own and keeps the spelling it was written with.
 *
 * @param  {Array}      edgeDeclarations  The four edge declarations, in top/right/bottom/left order.
 * @return {Array|null}                   The trio declarations, or null when the edges cannot be split.
 */
function buildBorderTrioDeclarations (edgeDeclarations) {
  const edgeParts = [];
  for (const declaration of edgeDeclarations) {
    if (typeof declaration.value !== 'string') {
      return null;
    }
    const parts = splitBorderEdgeValue(declaration.value.trim());
    if (!parts) {
      return null;
    }
    edgeParts.push(parts);
  }

  // The three parts do not affect one another, so they are written in the fixed
  // order the `border` grammar takes them in, rather than in an order the values
  // would decide. A predictable order repeats across rules, which compresses
  // better than one that varies.
  return BORDER_TRIO_PROPERTIES.map((property) => {
    const sideValues = edgeParts.map((parts) => {
      return parts[property];
    });
    return {
      property,
      value: collapseShorthandParts(sideValues).join(' '),
      isAssembledShorthand: true
    };
  });
}

/**
 * Measures what a set of declarations costs in the output, which is the text of
 * each of them joined by the semicolons that separate them.
 *
 * @param  {Array}  declarations  The declarations to measure.
 * @return {number}               The number of characters the declarations take up.
 */
function measureDeclarations (declarations) {
  return declarations.map((declaration) => {
    return declaration.property + ':' + minifyValue(declaration);
  }).join(';').length;
}

/**
 * Rewrites four `border-<side>` declarations whose values differ into the
 * `border-width`, `border-style`, and `border-color` trio. Unlike `margin`, the
 * `border` shorthand is not a four-sided one: it takes a single width, style,
 * and color, so four differing edges have no `border` value to collapse into.
 * The trio, on the other hand, states each of the three parts once per side,
 * which spells the same borders out in fewer characters.
 *
 * @param  {Array} declarations  The declarations of a single rule.
 * @return {Array}               The declarations, with the edges rewritten when the trio is shorter.
 */
function splitBorderEdgesIntoTrio (declarations) {
  const declaredProperties = collectDeclaredProperties(declarations);
  // A rule that already states a part of the trio, or the whole border, would
  // gain a second declaration of it rather than a shorter spelling of the edges.
  const statesTrioAlready = ['border', ...BORDER_TRIO_PROPERTIES].some((property) => {
    return declaredProperties.has(property);
  });
  if (statesTrioAlready) {
    return declarations;
  }

  const edgeDeclarations = collectBorderEdgeDeclarations(declarations);
  if (!edgeDeclarations) {
    return declarations;
  }

  const edgeValues = edgeDeclarations.map((declaration) => {
    return minifyValue(declaration);
  });
  const importantEdges = edgeValues.filter((value) => {
    return value.includes('!important');
  });
  // An edge whose importance differs from its siblings cannot join a shared
  // declaration, which carries one importance for all four sides.
  const hasUniformImportance = importantEdges.length === 0 || importantEdges.length === edgeValues.length;
  if (!hasUniformImportance) {
    return declarations;
  }
  const importantSuffix = importantEdges.length ? '!important' : '';

  const trioDeclarations = buildBorderTrioDeclarations(edgeDeclarations.map((declaration) => {
    return {
      ...declaration,
      // Match a trailing importance flag, which the trio carries once instead
      value: String(declaration.value).replace(/\s*!\s*important\s*$/i, '')
    };
  }));
  if (!trioDeclarations) {
    return declarations;
  }
  const importantTrioDeclarations = trioDeclarations.map((declaration) => {
    return {
      ...declaration,
      value: declaration.value + importantSuffix
    };
  });

  const isShorter = measureDeclarations(importantTrioDeclarations) < measureDeclarations(edgeDeclarations);
  if (!isShorter) {
    return declarations;
  }

  const insertionIndex = declarations.findIndex((declaration) => {
    return BORDER_EDGE_PROPERTIES.includes(declaration.property);
  });
  return declarations.flatMap((declaration, index) => {
    if (index === insertionIndex) {
      return importantTrioDeclarations;
    }
    if (BORDER_EDGE_PROPERTIES.includes(declaration.property)) {
      return [];
    }
    return [declaration];
  });
}

export {
  collapseBorderTrioWithPerEdgeColor,
  splitBorderEdgesIntoTrio
};

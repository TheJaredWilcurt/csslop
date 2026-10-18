/**
 * @file Safely minifies the SVG markup carried by UTF-8 data URLs.
 */

import {
  namedColors,
  parseColor,
  rgbaToHex
} from './colors.js';

const COLOR_ATTRIBUTE_NAMES = new Set([
  'color',
  'fill',
  'flood-color',
  'lighting-color',
  'solid-color',
  'stop-color',
  'stroke'
]);

const SELF_CLOSING_SVG_ELEMENTS = new Set([
  'animate',
  'animatemotion',
  'animatetransform',
  'circle',
  'ellipse',
  'image',
  'line',
  'path',
  'polygon',
  'polyline',
  'rect',
  'set',
  'stop',
  'use'
]);

const TEXT_WHITESPACE_ELEMENTS = new Set([
  'desc',
  'foreignobject',
  'metadata',
  'script',
  'style',
  'text',
  'textpath',
  'title',
  'tspan'
]);

/**
 * Determines whether a character is CSS or XML whitespace.
 *
 * @param  {string}  character  The character to inspect.
 * @return {boolean}            Whether the character is whitespace.
 */
function isWhitespace (character) {
  return ' \t\n\r\f'.includes(character);
}

/**
 * Determines whether a character may occur in an XML element or attribute name.
 *
 * @param  {string}  character  The character to inspect.
 * @return {boolean}            Whether the character is a supported XML name character.
 */
function isXmlNameCharacter (character) {
  return (
    (character >= 'a' && character <= 'z') ||
    (character >= 'A' && character <= 'Z') ||
    (character >= '0' && character <= '9') ||
    '_:-.'.includes(character)
  );
}

/**
 * Reads an XML name beginning at an index.
 *
 * @param  {string} text   The SVG markup being read.
 * @param  {number} index  The index where the name starts.
 * @return {object}        The name and the index immediately after it.
 */
function readXmlName (text, index) {
  const startIndex = index;
  while (index < text.length && isXmlNameCharacter(text[index])) {
    index++;
  }
  return {
    name: text.slice(startIndex, index),
    nextIndex: index
  };
}

/**
 * Converts a full hex color to its short notation when each channel pair matches.
 *
 * @param  {string} hexColor  A CSS hex color beginning with `#`.
 * @return {string}           The shortest equivalent hex color.
 */
function shortenHexColor (hexColor) {
  const digits = hexColor.slice(1);
  if (digits.length !== 6 && digits.length !== 8) {
    return hexColor;
  }
  let shortenedDigits = '';
  for (let index = 0; index < digits.length; index += 2) {
    if (digits[index] !== digits[index + 1]) {
      return hexColor;
    }
    shortenedDigits += digits[index];
  }
  return '#' + shortenedDigits;
}

/**
 * Chooses the shortest data-URL-safe spelling of a parsed SVG color.
 *
 * @param  {Array}  color  The parsed [red, green, blue, alpha] channels.
 * @return {string}        The shortest encoded hex or named color spelling.
 */
function formatSvgColor (color) {
  const hexColor = shortenHexColor(rgbaToHex(color[0], color[1], color[2], color[3]));
  let shortest = '%23' + hexColor.slice(1);
  const isOpaque = Math.round(color[3] * 255) === 255;
  if (!isOpaque) {
    return shortest;
  }

  for (const [name, channels] of Object.entries(namedColors)) {
    const channelsMatch = (
      channels[0] === color[0] &&
      channels[1] === color[1] &&
      channels[2] === color[2]
    );
    if (channelsMatch && name.length < shortest.length) {
      shortest = name;
    }
  }
  return shortest;
}

/**
 * Minifies a color-bearing SVG attribute only when it is a static CSS color.
 *
 * @param  {string} attributeName   The attribute name.
 * @param  {string} attributeValue  The attribute value without its quotes.
 * @return {string}                 The minified value, or the original value.
 */
function minifySvgAttributeValue (attributeName, attributeValue) {
  if (!COLOR_ATTRIBUTE_NAMES.has(attributeName.toLowerCase())) {
    return attributeValue;
  }
  const color = parseColor(attributeValue);
  if (!color) {
    return attributeValue;
  }
  return formatSvgColor(color);
}

/**
 * Finds the closing angle bracket of an XML tag without treating a quoted
 * attribute value as markup.
 *
 * @param  {string} text        The SVG markup being read.
 * @param  {number} startIndex  The index of the opening `<`.
 * @return {number}             The closing `>` index, or -1 when unterminated.
 */
function findSvgTagEnd (text, startIndex) {
  let quoteCharacter = '';
  for (let index = startIndex + 1; index < text.length; index++) {
    const character = text[index];
    if (quoteCharacter) {
      if (character === quoteCharacter) {
        quoteCharacter = '';
      }
      continue;
    }
    if (character === '"' || character === '\'') {
      quoteCharacter = character;
      continue;
    }
    if (character === '>') {
      return index;
    }
  }
  return -1;
}

/**
 * Parses and minifies an SVG start or end tag while preserving all attribute
 * values except static color values.
 *
 * @param  {string}      rawTag  The complete source tag, including angle brackets.
 * @return {object|null}         A normalized token, or null when unsupported.
 */
function minifySvgTag (rawTag) {
  let index = 1;
  if (rawTag[index] === '/') {
    index++;
    while (isWhitespace(rawTag[index])) {
      index++;
    }
    const nameResult = readXmlName(rawTag, index);
    if (!nameResult.name) {
      return null;
    }
    index = nameResult.nextIndex;
    while (isWhitespace(rawTag[index])) {
      index++;
    }
    if (rawTag[index] !== '>') {
      return null;
    }
    return {
      type: 'end',
      name: nameResult.name.toLowerCase(),
      value: '</' + nameResult.name + '>'
    };
  }

  while (isWhitespace(rawTag[index])) {
    index++;
  }
  const nameResult = readXmlName(rawTag, index);
  if (!nameResult.name) {
    return null;
  }
  index = nameResult.nextIndex;
  const attributes = [];
  let selfClosing = false;

  while (index < rawTag.length) {
    while (isWhitespace(rawTag[index])) {
      index++;
    }
    if (rawTag[index] === '>') {
      break;
    }
    if (rawTag[index] === '/' && rawTag[index + 1] === '>') {
      selfClosing = true;
      break;
    }

    const attributeResult = readXmlName(rawTag, index);
    if (!attributeResult.name) {
      return null;
    }
    index = attributeResult.nextIndex;
    while (isWhitespace(rawTag[index])) {
      index++;
    }

    let attribute = attributeResult.name;
    if (rawTag[index] === '=') {
      index++;
      while (isWhitespace(rawTag[index])) {
        index++;
      }
      const quoteCharacter = rawTag[index];
      if (quoteCharacter === '"' || quoteCharacter === '\'') {
        const valueStart = index + 1;
        index = valueStart;
        while (index < rawTag.length && rawTag[index] !== quoteCharacter) {
          index++;
        }
        if (index >= rawTag.length) {
          return null;
        }
        const attributeValue = rawTag.slice(valueStart, index);
        index++;
        attribute += '=' + quoteCharacter +
          minifySvgAttributeValue(attributeResult.name, attributeValue) +
          quoteCharacter;
      } else {
        const valueStart = index;
        while (index < rawTag.length && !isWhitespace(rawTag[index]) && rawTag[index] !== '>') {
          index++;
        }
        const attributeValue = rawTag.slice(valueStart, index);
        attribute += '=' + minifySvgAttributeValue(attributeResult.name, attributeValue);
      }
    }
    attributes.push(attribute);
  }

  return {
    type: 'start',
    name: nameResult.name.toLowerCase(),
    selfClosing,
    value: '<' + nameResult.name + (attributes.length ? ' ' + attributes.join(' ') : '') + (selfClosing ? '/>' : '>')
  };
}

/**
 * Turns SVG markup into tag and text tokens while preserving opaque XML
 * constructs that could carry script or declaration content.
 *
 * @param  {string}     svgMarkup  The decoded SVG markup.
 * @return {Array|null}            The tokens, or null when markup cannot be safely read.
 */
function tokenizeSvgMarkup (svgMarkup) {
  const tokens = [];
  let index = 0;
  while (index < svgMarkup.length) {
    const tagStartIndex = svgMarkup.indexOf('<', index);
    if (tagStartIndex === -1) {
      tokens.push({ type: 'text', value: svgMarkup.slice(index) });
      break;
    }
    if (tagStartIndex > index) {
      tokens.push({ type: 'text', value: svgMarkup.slice(index, tagStartIndex) });
    }
    if (svgMarkup.startsWith('<!--', tagStartIndex)) {
      const commentEndIndex = svgMarkup.indexOf('-->', tagStartIndex + 4);
      if (commentEndIndex === -1) {
        return null;
      }
      tokens.push({ type: 'other', value: svgMarkup.slice(tagStartIndex, commentEndIndex + 3) });
      index = commentEndIndex + 3;
      continue;
    }
    if (svgMarkup.startsWith('<![CDATA[', tagStartIndex)) {
      const cdataEndIndex = svgMarkup.indexOf(']]>', tagStartIndex + 9);
      if (cdataEndIndex === -1) {
        return null;
      }
      tokens.push({ type: 'text', value: svgMarkup.slice(tagStartIndex, cdataEndIndex + 3) });
      index = cdataEndIndex + 3;
      continue;
    }
    if (svgMarkup.startsWith('<!', tagStartIndex)) {
      return null;
    }

    const tagEndIndex = findSvgTagEnd(svgMarkup, tagStartIndex);
    if (tagEndIndex === -1) {
      return null;
    }
    const rawTag = svgMarkup.slice(tagStartIndex, tagEndIndex + 1);
    if (rawTag.startsWith('<?')) {
      tokens.push({ type: 'other', value: rawTag });
    } else {
      const tag = minifySvgTag(rawTag);
      if (!tag) {
        return null;
      }
      tokens.push(tag);
    }
    index = tagEndIndex + 1;
  }
  return tokens;
}

/**
 * Determines whether a text token contains no non-whitespace content.
 *
 * @param  {string}  text  The text to inspect.
 * @return {boolean}       Whether the text contains only whitespace.
 */
function hasOnlyWhitespace (text) {
  for (const character of text) {
    if (!isWhitespace(character)) {
      return false;
    }
  }
  return true;
}

/**
 * Drops formatting whitespace outside SVG elements whose text content matters.
 *
 * @param  {Array} tokens  The SVG tokens in source order.
 * @return {Array}         Tokens with insignificant text whitespace removed.
 */
function dropInsignificantWhitespace (tokens) {
  const result = [];
  const openElements = [];
  for (const token of tokens) {
    const currentElement = openElements[openElements.length - 1];
    const preservesWhitespace = TEXT_WHITESPACE_ELEMENTS.has(currentElement);
    if (token.type !== 'text' || !hasOnlyWhitespace(token.value) || preservesWhitespace) {
      result.push(token);
    }
    if (token.type === 'start' && !token.selfClosing) {
      openElements.push(token.name);
    }
    if (token.type === 'end' && openElements[openElements.length - 1] === token.name) {
      openElements.pop();
    }
  }
  return result;
}

/**
 * Rewrites supported SVG elements with no content into their XML self-closing form.
 *
 * @param  {Array} tokens  The compact SVG tokens.
 * @return {Array}         The compact tokens with empty elements collapsed.
 */
function collapseEmptySvgElements (tokens) {
  const result = [];
  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index];
    const nextToken = tokens[index + 1];
    const canCollapse = (
      token.type === 'start' &&
      !token.selfClosing &&
      SELF_CLOSING_SVG_ELEMENTS.has(token.name) &&
      nextToken?.type === 'end' &&
      nextToken.name === token.name
    );
    if (canCollapse) {
      result.push({
        ...token,
        selfClosing: true,
        value: token.value.slice(0, -1) + '/>'
      });
      index++;
      continue;
    }
    result.push(token);
  }
  return result;
}

/**
 * Minifies SVG markup while leaving unrecognized XML constructs untouched.
 *
 * @param  {string}      svgMarkup  The decoded SVG data.
 * @return {string|null}            The minified SVG, or null when it is unsafe to rewrite.
 */
function minifySvgMarkup (svgMarkup) {
  const tokens = tokenizeSvgMarkup(svgMarkup);
  if (!tokens) {
    return null;
  }
  const compactTokens = collapseEmptySvgElements(dropInsignificantWhitespace(tokens));
  let result = '';
  for (const token of compactTokens) {
    result += token.value;
  }
  return result;
}

export { minifySvgMarkup };

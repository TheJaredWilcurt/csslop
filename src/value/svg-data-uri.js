/**
 * @file Decodes, minifies, and safely reserializes SVG data URLs.
 */

import { minifySvgMarkup } from './svg-markup.js';

const SVG_MEDIA_TYPE = 'data:image/svg+xml';

/**
 * Determines whether a character is an ASCII hexadecimal digit.
 *
 * @param  {string}  character  The character to inspect.
 * @return {boolean}            Whether the character is hexadecimal.
 */
function isHexDigit (character) {
  return (
    (character >= '0' && character <= '9') ||
    (character >= 'a' && character <= 'f') ||
    (character >= 'A' && character <= 'F')
  );
}

/**
 * Determines whether a character is CSS whitespace.
 *
 * @param  {string}  character  The character to inspect.
 * @return {boolean}            Whether the character is whitespace.
 */
function isCssWhitespace (character) {
  return ' \t\n\r\f'.includes(character);
}

/**
 * Resolves CSS string escapes so that embedded SVG markup can be parsed.
 *
 * @param  {string} value  The raw CSS string content.
 * @return {string}        The decoded string content.
 */
function decodeCssStringEscapes (value) {
  let result = '';
  for (let index = 0; index < value.length; index++) {
    const character = value[index];
    if (character !== '\\' || index === value.length - 1) {
      result += character;
      continue;
    }

    const escapedCharacter = value[index + 1];
    if (escapedCharacter === '\n') {
      index++;
      continue;
    }
    if (escapedCharacter === '\r') {
      index++;
      if (value[index + 1] === '\n') {
        index++;
      }
      continue;
    }
    if (!isHexDigit(escapedCharacter)) {
      result += escapedCharacter;
      index++;
      continue;
    }

    let escapeEnd = index + 1;
    while (escapeEnd < value.length && escapeEnd < index + 7 && isHexDigit(value[escapeEnd])) {
      escapeEnd++;
    }
    const codePoint = parseInt(value.slice(index + 1, escapeEnd), 16);
    try {
      result += String.fromCodePoint(codePoint);
    } catch {
      result += value.slice(index, escapeEnd);
    }
    index = escapeEnd - 1;
    if (isCssWhitespace(value[index + 1])) {
      index++;
    }
  }
  return result;
}

/**
 * Decodes valid percent escapes without treating a literal percent sign as an
 * error. Malformed UTF-8 stays unmodified so the URL is left untouched.
 *
 * @param  {string}      value  The URI payload to decode.
 * @return {string|null}        The decoded payload, or null when unsafe.
 */
function decodePercentEncodedText (value) {
  let safelyEncodedValue = '';
  for (let index = 0; index < value.length; index++) {
    const isPercentEscape = (
      value[index] === '%' &&
      isHexDigit(value[index + 1]) &&
      isHexDigit(value[index + 2])
    );
    if (value[index] === '%' && !isPercentEscape) {
      safelyEncodedValue += '%25';
      continue;
    }
    safelyEncodedValue += value[index];
  }
  try {
    return decodeURIComponent(safelyEncodedValue);
  } catch {
    return null;
  }
}

/**
 * Decodes base64 data to UTF-8 without depending on Node-only APIs.
 *
 * @param  {string}      value  The base64 data.
 * @return {string|null}        The decoded SVG text, or null when unavailable or invalid.
 */
function decodeBase64Utf8 (value) {
  if (typeof atob !== 'function' || typeof TextDecoder !== 'function') {
    return null;
  }
  try {
    const binaryText = atob(value);
    const bytes = new Uint8Array(binaryText.length);
    for (let index = 0; index < binaryText.length; index++) {
      bytes[index] = binaryText.codePointAt(index);
    }
    return new TextDecoder().decode(bytes);
  } catch {
    return null;
  }
}

/**
 * Parses the supported SVG data URL forms and chooses the output media prefix.
 *
 * @param  {string}      urlContent  The decoded content inside `url(...)`.
 * @return {object|null}             The SVG markup and output prefix, or null when unsupported.
 */
function parseSvgDataUri (urlContent) {
  const separatorIndex = urlContent.indexOf(',');
  if (separatorIndex === -1) {
    return null;
  }
  const header = urlContent.slice(0, separatorIndex);
  const normalizedHeader = header.toLowerCase();
  if (
    !normalizedHeader.startsWith(SVG_MEDIA_TYPE) ||
    (header.length > SVG_MEDIA_TYPE.length && header[SVG_MEDIA_TYPE.length] !== ';')
  ) {
    return null;
  }

  const parameterText = header.slice(SVG_MEDIA_TYPE.length);
  const parameters = parameterText ? parameterText.slice(1).split(';') : [];
  let usesBase64 = false;
  let usesUtf8 = false;
  for (const parameter of parameters) {
    const normalizedParameter = parameter.toLowerCase();
    if (normalizedParameter === 'base64') {
      usesBase64 = true;
    } else if (
      normalizedParameter === 'utf8' ||
      normalizedParameter === 'charset=utf-8' ||
      normalizedParameter === 'charset=utf8'
    ) {
      usesUtf8 = true;
    } else {
      return null;
    }
  }

  const encodedPayload = urlContent.slice(separatorIndex + 1);
  const decodedPayload = decodePercentEncodedText(encodedPayload);
  if (decodedPayload === null) {
    return null;
  }
  const svgMarkup = usesBase64 ? decodeBase64Utf8(decodedPayload) : decodedPayload;
  if (svgMarkup === null) {
    return null;
  }
  return {
    svgMarkup,
    outputPrefix: SVG_MEDIA_TYPE + (usesBase64 || usesUtf8 ? ';utf8' : '')
  };
}

/**
 * Checks whether decoded data begins with an SVG root element, allowing an XML
 * declaration in front of it.
 *
 * @param  {string}  svgMarkup  The decoded data URI payload.
 * @return {boolean}            Whether the payload appears to be SVG markup.
 */
function startsWithSvgElement (svgMarkup) {
  let index = 0;
  while (isCssWhitespace(svgMarkup[index])) {
    index++;
  }
  if (svgMarkup.startsWith('<?xml', index)) {
    const declarationEnd = svgMarkup.indexOf('?>', index + 5);
    if (declarationEnd === -1) {
      return false;
    }
    index = declarationEnd + 2;
    while (isCssWhitespace(svgMarkup[index])) {
      index++;
    }
  }
  const candidate = svgMarkup.slice(index, index + 4).toLowerCase();
  const nextCharacter = svgMarkup[index + 4];
  return candidate === '<svg' && (
    isCssWhitespace(nextCharacter) ||
    nextCharacter === '>' ||
    nextCharacter === '/'
  );
}

/**
 * Escapes text for one CSS string delimiter.
 *
 * @param  {string} value           The string content.
 * @param  {string} quoteCharacter  The surrounding CSS string delimiter.
 * @return {string}                 The escaped CSS string content.
 */
function escapeCssStringContent (value, quoteCharacter) {
  let result = '';
  for (const character of value) {
    if (character === '\\' || character === quoteCharacter) {
      result += '\\' + character;
    } else if (character === '\n') {
      result += '\\a ';
    } else if (character === '\r') {
      result += '\\d ';
    } else if (character === '\f') {
      result += '\\c ';
    } else {
      result += character;
    }
  }
  return result;
}

/**
 * Chooses the CSS string wrapper that needs the fewest escaping backslashes.
 *
 * @param  {string} dataUri  The normalized SVG data URI.
 * @return {string}          The URL content with surrounding quotes.
 */
function formatSvgDataUri (dataUri) {
  const singleQuotedContent = escapeCssStringContent(dataUri, '\'');
  const doubleQuotedContent = escapeCssStringContent(dataUri, '"');
  if (singleQuotedContent.length < doubleQuotedContent.length) {
    return '\'' + singleQuotedContent + '\'';
  }
  return '"' + doubleQuotedContent + '"';
}

/**
 * Minifies an SVG data URI and returns CSS-ready URL content.
 *
 * @param  {string}      urlContent  The unwrapped content of a CSS `url(...)`.
 * @return {string|null}             The formatted replacement, or null when not SVG data.
 */
function minifySvgDataUri (urlContent) {
  const decodedUrlContent = decodeCssStringEscapes(urlContent);
  const parsedDataUri = parseSvgDataUri(decodedUrlContent);
  if (!parsedDataUri || !startsWithSvgElement(parsedDataUri.svgMarkup)) {
    return null;
  }
  const minifiedSvg = minifySvgMarkup(parsedDataUri.svgMarkup);
  if (minifiedSvg === null) {
    return null;
  }
  // A literal hash starts a URL fragment, so SVG IDs and hex colors need URI encoding.
  const encodedSvg = minifiedSvg.split('#').join('%23');
  return formatSvgDataUri(parsedDataUri.outputPrefix + ',' + encodedSvg);
}

export { minifySvgDataUri };

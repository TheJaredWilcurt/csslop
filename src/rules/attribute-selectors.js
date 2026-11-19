/**
 * @file Minifies attribute selectors by writing each value in its shortest form and dropping any case-sensitivity flag that the attribute already implies.
 */

/**
 * Matches an attribute selector's brackets: the attribute name, the matcher
 * (such as `=` or `^=`), the value, and the optional case-sensitivity flag `i`
 * or `s`. The value is a double-quoted string, a single-quoted string, or a run
 * of unquoted characters in which escapes may stand in for spaces.
 *
 * @type {RegExp}
 */
const ATTRIBUTE_SELECTOR_PATTERN = /\[\s*([^\s=\]]+?)\s*([~|^$*]?=)\s*("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|(?:\\.|[^\s"'\\\]])+)(?:\s*([is]))?\s*\]/gi;

/**
 * Matches a value that can be written without quotes: an identifier made of
 * letters, digits, hyphens, underscores, and escapes. It cannot start with a
 * digit, or with a hyphen followed by a digit.
 *
 * @type {RegExp}
 */
const UNQUOTED_ATTRIBUTE_VALUE_PATTERN = /^(?:-?[a-zA-Z_]|\\.)(?:[\w-]|\\.)*$/;

/**
 * HTML attributes whose values are matched ASCII case-insensitively by default,
 * per the HTML spec's list of case-insensitive attributes. Every other attribute
 * is matched case-sensitively, so its `s` flag is implied and its `i` flag is not.
 *
 * @type {Set<string>}
 */
const CASE_INSENSITIVE_HTML_ATTRIBUTES = new Set([
  'accept', 'accept-charset', 'align', 'alink', 'axis', 'bgcolor', 'charset',
  'checked', 'clear', 'codetype', 'color', 'compact', 'declare', 'defer', 'dir',
  'direction', 'disabled', 'enctype', 'face', 'frame', 'hreflang', 'http-equiv',
  'lang', 'language', 'link', 'media', 'method', 'multiple', 'nohref', 'noresize',
  'noshade', 'nowrap', 'readonly', 'rel', 'rev', 'rules', 'scope', 'scrolling',
  'selected', 'shape', 'target', 'text', 'type', 'valign', 'valuetype', 'vlink'
]);

/**
 * Writes the text of a quoted attribute value without its quotes, escaping the
 * characters that would otherwise end an unquoted identifier.
 *
 * @param  {string}      content  The value's text, without its quotes.
 * @return {string|null}          The unquoted value, or null when it cannot be written without quotes.
 */
function escapeAttributeValue (content) {
  if (content.includes('\\')) {
    return null;
  }
  // Escape special characters that require quoting (spaces, #, ., :, /, ;)
  const escaped = content.replace(/([ #.:/;])/g, '\\$1');
  if (!UNQUOTED_ATTRIBUTE_VALUE_PATTERN.test(escaped)) {
    return null;
  }
  return escaped;
}

/**
 * Writes an attribute value with double quotes, removing the escapes that only
 * an unquoted value needs. A value that already has quotes keeps them, unless
 * a single-quoted value holds a double quote that would have to be escaped.
 *
 * @param  {string} rawValue  The value as written, with or without quotes.
 * @return {string}           The value wrapped in double quotes.
 */
function quoteAttributeValue (rawValue) {
  if (rawValue[0] === '"' || rawValue[0] === '\'') {
    const content = rawValue.slice(1, -1);
    return content.includes('"') ? rawValue : '"' + content + '"';
  }
  // Unescape the characters that only an unquoted value needs escaped
  return '"' + rawValue.replace(/\\([ #.:/;])/g, '$1') + '"';
}

/**
 * Writes an attribute value and its case-sensitivity flag in whichever form is
 * shorter. A value written with quotes stays quoted on a tie, and a value written
 * without quotes stays unquoted. A flag after an unquoted value needs a space,
 * but a flag after a quoted value does not.
 *
 * @param  {string}      rawValue  The value as written, including its quotes when it has them.
 * @param  {string|null} flag      The flag as written, or null when there is none.
 * @return {string}                The value followed by the flag, in its shortest form.
 */
function formatAttributeValue (rawValue, flag) {
  const isQuoted = rawValue[0] === '"' || rawValue[0] === '\'';
  const quotedForm = quoteAttributeValue(rawValue) + (flag || '');
  const unquotedValue = isQuoted ? escapeAttributeValue(rawValue.slice(1, -1)) : rawValue;
  if (unquotedValue === null) {
    return quotedForm;
  }
  const unquotedForm = unquotedValue + (flag ? ' ' + flag : '');
  const useUnquoted = isQuoted ? unquotedForm.length < quotedForm.length : unquotedForm.length <= quotedForm.length;
  return useUnquoted ? unquotedForm : quotedForm;
}

/**
 * Drops a case-sensitivity flag when it matches what the attribute already does
 * by default. `i` is redundant on an attribute that is case-insensitive by
 * default, and `s` is redundant on one that is case-sensitive by default.
 *
 * @param  {string}      attribute  The attribute name as written.
 * @param  {string|null} flag       The flag as written, or null when there is none.
 * @return {string|null}            The flag to keep, or null when it can be removed.
 */
function getEffectiveCaseFlag (attribute, flag) {
  if (!flag) {
    return null;
  }
  const isCaseInsensitiveByDefault = CASE_INSENSITIVE_HTML_ATTRIBUTES.has(attribute.toLowerCase());
  const isCaseInsensitiveFlag = flag.toLowerCase() === 'i';
  const isFlagRedundant = isCaseInsensitiveFlag === isCaseInsensitiveByDefault;
  return isFlagRedundant ? null : flag;
}

/**
 * Writes each attribute selector's value quoted or escaped, whichever is
 * shorter, removes a case-sensitivity flag that is redundant for the attribute,
 * and removes the whitespace inside its brackets.
 *
 * @param  {string} selector  A selector with its whitespace already collapsed.
 * @return {string}           The selector with minified attribute selectors.
 */
function minifyAttributeSelectors (selector) {
  return selector.replace(ATTRIBUTE_SELECTOR_PATTERN, (match, attribute, matcher, rawValue, flag) => {
    const effectiveFlag = getEffectiveCaseFlag(attribute, flag);
    return '[' + attribute + matcher + formatAttributeValue(rawValue, effectiveFlag) + ']';
  });
}

export { minifyAttributeSelectors };

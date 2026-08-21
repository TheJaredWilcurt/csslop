/**
 * @file Resolves `@charset` labels against the Encoding Standard so charset rules can be deduplicated, hoisted, shortened, or removed.
 */

/**
 * The default encoding of a stylesheet, used when no `@charset` is declared.
 *
 * @type {string}
 */
const DEFAULT_ENCODING = 'UTF-8';

/**
 * Encodings that a stylesheet can never actually be in when labelled by a
 * `@charset` rule. The rule itself is written in ASCII bytes, so a UTF-16
 * label falls back to UTF-8 when determining the fallback encoding.
 * https://drafts.csswg.org/css-syntax-3/#determine-the-fallback-encoding
 *
 * @type {Set<string>}
 */
const UTF_16_ENCODINGS = new Set(['UTF-16BE', 'UTF-16LE']);

/**
 * Every encoding name of the Encoding Standard mapped to all of its labels.
 * A `@charset` label is looked up here (ASCII case-insensitively, after
 * trimming whitespace) to find the encoding a browser will use, and any label
 * of that encoding can be swapped in without changing how the file is decoded.
 * https://encoding.spec.whatwg.org/#names-and-labels
 *
 * @type {object}
 */
const ENCODING_LABELS = {
  // The encoding
  'UTF-8': ['unicode-1-1-utf-8', 'unicode11utf8', 'unicode20utf8', 'utf-8', 'utf8', 'x-unicode20utf8'],
  // Legacy single-byte encodings
  IBM866: ['866', 'cp866', 'csibm866', 'ibm866'],
  'ISO-8859-2': ['csisolatin2', 'iso-8859-2', 'iso-ir-101', 'iso8859-2', 'iso88592', 'iso_8859-2', 'iso_8859-2:1987', 'l2', 'latin2'],
  'ISO-8859-3': ['csisolatin3', 'iso-8859-3', 'iso-ir-109', 'iso8859-3', 'iso88593', 'iso_8859-3', 'iso_8859-3:1988', 'l3', 'latin3'],
  'ISO-8859-4': ['csisolatin4', 'iso-8859-4', 'iso-ir-110', 'iso8859-4', 'iso88594', 'iso_8859-4', 'iso_8859-4:1988', 'l4', 'latin4'],
  'ISO-8859-5': ['csisolatincyrillic', 'cyrillic', 'iso-8859-5', 'iso-ir-144', 'iso8859-5', 'iso88595', 'iso_8859-5', 'iso_8859-5:1988'],
  'ISO-8859-6': ['arabic', 'asmo-708', 'csiso88596e', 'csiso88596i', 'csisolatinarabic', 'ecma-114', 'iso-8859-6', 'iso-8859-6-e', 'iso-8859-6-i', 'iso-ir-127', 'iso8859-6', 'iso88596', 'iso_8859-6', 'iso_8859-6:1987'],
  'ISO-8859-7': ['csisolatingreek', 'ecma-118', 'elot_928', 'greek', 'greek8', 'iso-8859-7', 'iso-ir-126', 'iso8859-7', 'iso88597', 'iso_8859-7', 'iso_8859-7:1987', 'sun_eu_greek'],
  'ISO-8859-8': ['csiso88598e', 'csisolatinhebrew', 'hebrew', 'iso-8859-8', 'iso-8859-8-e', 'iso-ir-138', 'iso8859-8', 'iso88598', 'iso_8859-8', 'iso_8859-8:1988', 'visual'],
  'ISO-8859-8-I': ['csiso88598i', 'iso-8859-8-i', 'logical'],
  'ISO-8859-10': ['csisolatin6', 'iso-8859-10', 'iso-ir-157', 'iso8859-10', 'iso885910', 'l6', 'latin6'],
  'ISO-8859-13': ['iso-8859-13', 'iso8859-13', 'iso885913'],
  'ISO-8859-14': ['iso-8859-14', 'iso8859-14', 'iso885914'],
  'ISO-8859-15': ['csisolatin9', 'iso-8859-15', 'iso8859-15', 'iso885915', 'iso_8859-15', 'l9'],
  'ISO-8859-16': ['iso-8859-16'],
  'KOI8-R': ['cskoi8r', 'koi', 'koi8', 'koi8-r', 'koi8_r'],
  'KOI8-U': ['koi8-ru', 'koi8-u'],
  macintosh: ['csmacintosh', 'mac', 'macintosh', 'x-mac-roman'],
  'windows-874': ['dos-874', 'iso-8859-11', 'iso8859-11', 'iso885911', 'tis-620', 'windows-874'],
  'windows-1250': ['cp1250', 'windows-1250', 'x-cp1250'],
  'windows-1251': ['cp1251', 'windows-1251', 'x-cp1251'],
  'windows-1252': ['ansi_x3.4-1968', 'ascii', 'cp1252', 'cp819', 'csisolatin1', 'ibm819', 'iso-8859-1', 'iso-ir-100', 'iso8859-1', 'iso88591', 'iso_8859-1', 'iso_8859-1:1987', 'l1', 'latin1', 'us-ascii', 'windows-1252', 'x-cp1252'],
  'windows-1253': ['cp1253', 'windows-1253', 'x-cp1253'],
  'windows-1254': ['cp1254', 'csisolatin5', 'iso-8859-9', 'iso-ir-148', 'iso8859-9', 'iso88599', 'iso_8859-9', 'iso_8859-9:1989', 'l5', 'latin5', 'windows-1254', 'x-cp1254'],
  'windows-1255': ['cp1255', 'windows-1255', 'x-cp1255'],
  'windows-1256': ['cp1256', 'windows-1256', 'x-cp1256'],
  'windows-1257': ['cp1257', 'windows-1257', 'x-cp1257'],
  'windows-1258': ['cp1258', 'windows-1258', 'x-cp1258'],
  'x-mac-cyrillic': ['x-mac-cyrillic', 'x-mac-ukrainian'],
  // Legacy multi-byte Chinese (simplified) encodings
  GBK: ['chinese', 'csgb2312', 'csiso58gb231280', 'gb2312', 'gb_2312', 'gb_2312-80', 'gbk', 'iso-ir-58', 'x-gbk'],
  gb18030: ['gb18030'],
  // Legacy multi-byte Chinese (traditional) encodings
  Big5: ['big5', 'big5-hkscs', 'cn-big5', 'csbig5', 'x-x-big5'],
  // Legacy multi-byte Japanese encodings
  'EUC-JP': ['cseucpkdfmtjapanese', 'euc-jp', 'x-euc-jp'],
  'ISO-2022-JP': ['csiso2022jp', 'iso-2022-jp'],
  Shift_JIS: ['csshiftjis', 'ms932', 'ms_kanji', 'shift-jis', 'shift_jis', 'sjis', 'windows-31j', 'x-sjis'],
  // Legacy multi-byte Korean encodings
  'EUC-KR': ['cseuckr', 'csksc56011987', 'euc-kr', 'iso-ir-149', 'korean', 'ks_c_5601-1987', 'ks_c_5601-1989', 'ksc5601', 'ksc_5601', 'windows-949'],
  // Legacy miscellaneous encodings
  replacement: ['csiso2022kr', 'hz-gb-2312', 'iso-2022-cn', 'iso-2022-cn-ext', 'iso-2022-kr', 'replacement'],
  'UTF-16BE': ['unicodefffe', 'utf-16be'],
  'UTF-16LE': ['csunicode', 'iso-10646-ucs-2', 'ucs-2', 'unicode', 'unicodefeff', 'utf-16', 'utf-16le'],
  'x-user-defined': ['x-user-defined']
};

/**
 * Builds the lookup of every Encoding Standard label to the encoding it names.
 *
 * @return {Map} Map of lowercase label to encoding name.
 */
function createEncodingByLabelLookup () {
  const encodingByLabel = new Map();
  for (const encodingName in ENCODING_LABELS) {
    for (const label of ENCODING_LABELS[encodingName]) {
      encodingByLabel.set(label, encodingName);
    }
  }
  return encodingByLabel;
}

/**
 * Builds the lookup of every encoding to its fewest-bytes label, so a
 * `@charset` rule can be rewritten with a shorter but equivalent label.
 * Labels of the same length are ordered alphabetically to keep output stable.
 *
 * @return {Map} Map of encoding name to its shortest label.
 */
function createShortestLabelLookup () {
  const shortestLabels = new Map();
  for (const encodingName in ENCODING_LABELS) {
    const labelsByLength = [...ENCODING_LABELS[encodingName]].sort((labelA, labelB) => {
      if (labelA.length !== labelB.length) {
        return labelA.length - labelB.length;
      }
      return labelA.localeCompare(labelB);
    });
    shortestLabels.set(encodingName, labelsByLength[0]);
  }
  return shortestLabels;
}

const ENCODING_BY_LABEL = createEncodingByLabelLookup();
const SHORTEST_LABEL_BY_ENCODING = createShortestLabelLookup();

/**
 * Reduces a raw `@charset` value to the label that gets looked up, by removing
 * the surrounding quotes, trimming whitespace, and lowercasing it, since
 * Encoding Standard labels are matched ASCII case-insensitively.
 *
 * @param  {string} charsetValue  The `@charset` value, with or without surrounding quotes.
 * @return {string}               The normalized label, or empty string when there is no value.
 */
function normalizeCharsetLabel (charsetValue) {
  if (!charsetValue) {
    return '';
  }
  // Remove one layer of matching single or double quotes wrapping the label
  const unquoted = String(charsetValue).trim().replace(/^(["'])([\s\S]*)\1$/, '$2');
  return unquoted.trim().toLowerCase();
}

/**
 * Resolves a `@charset` value to the encoding a browser will actually decode
 * the stylesheet with. Labels that are not in the Encoding Standard are
 * ignored, and UTF-16 labels fall back to UTF-8, so both leave the stylesheet
 * in the default encoding.
 *
 * @param  {string} charsetValue  The `@charset` value, with or without surrounding quotes.
 * @return {string}               The effective encoding name.
 */
function resolveEffectiveEncoding (charsetValue) {
  const encodingName = ENCODING_BY_LABEL.get(normalizeCharsetLabel(charsetValue));
  if (!encodingName || UTF_16_ENCODINGS.has(encodingName)) {
    return DEFAULT_ENCODING;
  }
  return encodingName;
}

/**
 * Determines whether a `@charset` value leaves the stylesheet in an encoding
 * that can represent every unicode character, meaning unicode escapes may be
 * safely replaced with the literal characters they resolve to.
 *
 * @param  {string}  charsetValue  The `@charset` value, with or without surrounding quotes.
 * @return {boolean}               True when the effective encoding supports all unicode characters.
 */
function isUnicodeCompatibleCharset (charsetValue) {
  return resolveEffectiveEncoding(charsetValue) === DEFAULT_ENCODING;
}

/**
 * Rewrites a `@charset` value as the shortest quoted label for the same
 * encoding, or as an empty string when the rule has no effect at all and can
 * be deleted, because the stylesheet is left in the default UTF-8 encoding.
 * The declared label is kept when no shorter label exists for its encoding.
 *
 * @param  {string} charsetValue  The `@charset` value, with or without surrounding quotes.
 * @return {string}               The shortest equivalent quoted value, or empty string when the rule is removable.
 */
function optimizeCharsetValue (charsetValue) {
  const encodingName = resolveEffectiveEncoding(charsetValue);
  if (encodingName === DEFAULT_ENCODING) {
    return '';
  }
  const declaredLabel = normalizeCharsetLabel(charsetValue);
  const shortestLabel = SHORTEST_LABEL_BY_ENCODING.get(encodingName);
  if (shortestLabel.length < declaredLabel.length) {
    return '"' + shortestLabel + '"';
  }
  return '"' + declaredLabel + '"';
}

/**
 * Finds the `@charset` value that applies to a stylesheet by scanning the raw
 * CSS text before it is parsed. Only the first `@charset` of a document has any
 * effect, so later ones (usually the result of concatenating files) are ignored.
 *
 * @param  {string} css  The raw CSS string to scan.
 * @return {string}      The first `@charset` value (with quotes), or empty string when none is declared.
 */
function detectCharset (css) {
  // Match @charset followed by a quoted value and semicolon
  const match = css.match(/@charset\s+(["'][^"']+["'])\s*;/i);
  if (match) {
    return match[1];
  }
  return '';
}

/**
 * Applies the browser's `@charset` handling to the top-level rules of a
 * stylesheet. Only the first `@charset` is meaningful, and it is only honored
 * when it is the very first thing in the file, so it is shortened and hoisted
 * to the front while every later `@charset` is dropped. A first `@charset` that
 * leaves the stylesheet in the default UTF-8 encoding is dropped as well.
 *
 * @param  {Array} rules  The top-level AST rule nodes to filter.
 * @return {Array}        A new array of rules, with at most one `@charset` rule, placed at the start.
 */
function filterRedundantCharsets (rules) {
  let hoistedCharset = null;
  let foundCharset = false;

  const filtered = rules.filter((rule) => {
    if (rule.type !== 'charset') {
      return true;
    }
    if (!foundCharset) {
      foundCharset = true;
      const optimizedCharset = optimizeCharsetValue(rule.charset);
      if (optimizedCharset) {
        hoistedCharset = {
          ...rule,
          charset: optimizedCharset
        };
      }
    }
    return false;
  });

  if (hoistedCharset) {
    return [hoistedCharset, ...filtered];
  }
  return filtered;
}

export {
  detectCharset,
  filterRedundantCharsets,
  isUnicodeCompatibleCharset
};

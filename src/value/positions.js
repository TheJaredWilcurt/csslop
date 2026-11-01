/**
 * @file Shortens position values: the keyword pairs of `position-area`, the keywords of `background-position`, and the separator between a layer's image and its position.
 */

/**
 * Map of position-area two-keyword values to their single-keyword equivalents.
 * Per CSS spec, `center center` is redundant with `center`, etc.
 *
 * @type {{[key: string]: string}}
 */
const POSITION_AREA_SHORTHANDS = {
  'center center': 'center',
  'top center': 'top',
  'bottom center': 'bottom',
  'center top': 'top',
  'center bottom': 'bottom',
  'left center': 'left',
  'right center': 'right'
};

/**
 * Map from background-position keyword names to their equivalent percent values.
 *
 * @type {{[key: string]: string}}
 */
const POSITION_KEYWORD_TO_PERCENT = {
  left: '0',
  center: '50%',
  right: '100%',
  top: '0',
  bottom: '100%'
};

/**
 * Converts background-position keyword values to their shorter percent
 * equivalents when possible. Single Y-axis keywords (top, bottom) and
 * multi-value offset syntax (3 or 4 values) are left unchanged.
 *
 * @param  {string} value  The background-position value string.
 * @return {string}        The value with keywords converted to percents where shorter.
 */
function convertBackgroundPositionKeywords (value) {
  // Split on whitespace to determine the number of position parts
  const parts = value.split(/\s+/);

  // 3 or 4 value syntax uses keyword offsets, retain keywords
  if (parts.length >= 3) {
    return value;
  }

  if (parts.length === 1) {
    const keyword = parts[0].toLowerCase();
    // Y-axis-only keywords (top, bottom) can't be expressed as a single X-axis percent
    const isYAxisOnly = keyword === 'top' || keyword === 'bottom';
    if (isYAxisOnly) {
      return value;
    }
    if (POSITION_KEYWORD_TO_PERCENT[keyword] !== undefined) {
      return POSITION_KEYWORD_TO_PERCENT[keyword];
    }
    return value;
  }

  if (parts.length === 2) {
    const firstKeyword = parts[0].toLowerCase();
    const secondKeyword = parts[1].toLowerCase();
    const firstIsPositionKeyword = POSITION_KEYWORD_TO_PERCENT[firstKeyword] !== undefined;
    const secondIsPositionKeyword = POSITION_KEYWORD_TO_PERCENT[secondKeyword] !== undefined;

    if (firstIsPositionKeyword && secondIsPositionKeyword) {
      const firstPercent = POSITION_KEYWORD_TO_PERCENT[firstKeyword];
      const secondPercent = POSITION_KEYWORD_TO_PERCENT[secondKeyword];
      // Collapse to single value when Y is center (50%), since a single value defaults Y to 50%
      if (secondPercent === '50%') {
        return firstPercent;
      }
      return firstPercent + ' ' + secondPercent;
    }
  }

  return value;
}

/**
 * Matches one offset of a position: an edge keyword or a numeric distance.
 *
 * @type {string}
 */
const POSITION_OFFSET_SOURCE = '(?:left|center|right|top|bottom|[+-]?(?:\\d+|\\d*\\.\\d+)(?:%|[a-z]+)?)';

/**
 * Matches a whole position component, which is one or two of those offsets.
 *
 * @type {string}
 */
const POSITION_COMPONENT_SOURCE = '(' + POSITION_OFFSET_SOURCE + '(?:\\s+' + POSITION_OFFSET_SOURCE + ')?)';

/**
 * Matches everything a `url()` holds up to but not including its own closing
 * parenthesis. A url is written without nested parentheses, so the first one
 * that closes it is the end of the token.
 *
 * @type {string}
 */
const URL_TOKEN_BODY_SOURCE = 'url\\([^()]*';

/**
 * Matches a close-paren that ends an image function, followed by a separated
 * position that no slash follows. The parenthesis that ends a `url()` is
 * skipped, since that one closes a token rather than a function.
 *
 * @type {RegExp}
 */
const SEPARATED_FUNCTION_POSITION_PATTERN = new RegExp('(?<!' + URL_TOKEN_BODY_SOURCE + ')\\)\\s+' + POSITION_COMPONENT_SOURCE + '(?!\\/)', 'gi');

/**
 * Matches a `url()` separated from the position that follows it, which is the
 * separator a url does not need.
 *
 * @type {RegExp}
 */
const SEPARATED_URL_POSITION_PATTERN = new RegExp('(' + URL_TOKEN_BODY_SOURCE + '\\))\\s+' + POSITION_COMPONENT_SOURCE, 'gi');

/**
 * Matches a close-paren separated from a position that a slash follows, where
 * the slash already delimits the position from the size behind it.
 *
 * @type {RegExp}
 */
const SEPARATED_IMAGE_SIZE_POSITION_PATTERN = new RegExp('\\)\\s+' + POSITION_COMPONENT_SOURCE + '(?=\\/)', 'gi');

/**
 * Normalizes the separator between the image of a layer and the position that
 * follows it. Both `background` and `mask` take a `<position> [ / <size> ]`
 * component after their image. The closing parenthesis already delimits a
 * function token from the position, and neither a position that a `/` follows
 * nor one that follows a `url()` needs a separator either.
 *
 * @param  {string} value  The layered image value, with the parenthesis padding removed.
 * @return {string}        The value with the position separator normalized.
 */
function normalizeImagePositionSeparator (value) {
  const joinedToFunction = value.replace(SEPARATED_FUNCTION_POSITION_PATTERN, ')$1');
  const joinedToUrl = joinedToFunction.replace(SEPARATED_URL_POSITION_PATTERN, '$1$2');
  return joinedToUrl.replace(SEPARATED_IMAGE_SIZE_POSITION_PATTERN, ')$1');
}

export {
  convertBackgroundPositionKeywords,
  normalizeImagePositionSeparator,
  POSITION_AREA_SHORTHANDS
};

/**
 * @file Parses a string of CSS to an abstract syntax tree (AST).
 */

import {
  AT_RULE_BODY,
  findAtRuleDefinition
} from './at-rules.js';
import {
  createLineIndex,
  createPosition,
  resolveSourceLocation
} from './positions.js';
import {
  CHARACTER_CODE,
  characterCodeAt,
  consumeCloseBrace,
  consumeColon,
  consumeComma,
  consumeOpenBrace,
  consumePattern,
  consumeTo,
  createScanner,
  hasMoreInput,
  peekPattern,
  skipSemicolonsAndWhitespace,
  skipWhitespace
} from './scanner.js';
import {
  findTopLevelDelimiter,
  splitTopLevel
} from './source-search.js';

/**
 * Matches a comment, from the current position, up to the first end of a
 * comment. A comment that is never closed runs to the end of the stylesheet,
 * which lets the parser report it and still move on.
 *
 * @type {RegExp}
 */
// The comment opener, the fewest characters of any kind, then a closer or the end of input
const COMMENT_PATTERN = /\/\*[^]*?(?:\*\/|$)/y;

/**
 * Matches every comment in a piece of text, so that comments can be removed
 * from the selectors and values they were written between.
 *
 * @type {RegExp}
 */
// The comment opener, the fewest characters of any kind, then a closer or the end of the text
const COMMENT_SEARCH_PATTERN = /\/\*[^]*?(?:\*\/|$)/g;

/**
 * Matches the property name of a declaration. Beyond the characters of an
 * identifier, the name may hold the punctuation of the hacks old stylesheets
 * use to hide a declaration from a browser, and may end with the bracketed
 * suffix of a vendor extension.
 *
 * @type {RegExp}
 */
// An optional leading asterisk, the name characters, an optional bracketed suffix, then the whitespace before the colon
const PROPERTY_NAME_PATTERN = /(\*?[-#/*\\\w]+(?:\[[0-9a-z_-]+\])?)\s*/y;

/**
 * Matches the name of an at-rule, which is what decides how the rest of it is
 * read.
 *
 * @type {RegExp}
 */
// The at-sign followed by an identifier
const AT_RULE_NAME_PATTERN = /@([-\w]+)/y;

/**
 * Matches one stop of a keyframe's selector, which is either a percentage or
 * one of the `from` and `to` keywords.
 *
 * @type {RegExp}
 */
// A number with an optional percent sign, or a keyword, then the whitespace behind it
const KEYFRAME_STOP_PATTERN = /((?:\d+\.\d+|\.\d+|\d+)%?|[a-z]+)\s*/y;

/**
 * How the parser reads the body of a block, which differs by what the block
 * is allowed to hold.
 *
 * @type {object}
 */
const BLOCK_CONTENTS = {
  declarationsOnly: {
    atRules: false,
    nestedRules: false
  },
  pageBody: {
    atRules: true,
    nestedRules: false
  },
  rulesAndDeclarations: {
    atRules: true,
    nestedRules: true
  }
};

/**
 * Creates everything the parse of one stylesheet needs: the reader that walks
 * the text, the line index its positions are resolved against, and the list
 * the errors of a silent parse are collected in.
 *
 * @param  {string} source   The raw CSS text to parse.
 * @param  {object} options  The options the caller parsed with.
 * @return {object}          The state shared by every step of the parse.
 */
function createParserState (source, options) {
  return {
    source,
    scanner: createScanner(source),
    sourceName: options.source || '',
    silent: Boolean(options.silent),
    preserveFormatting: Boolean(options.preserveFormatting),
    lineStartOffsets: createLineIndex(source),
    parsingErrors: []
  };
}

/**
 * Reports that the stylesheet does not say what the parser expected it to. A
 * silent parse collects the error and recovers, while any other parse stops
 * at the first thing it cannot read.
 *
 * @param {object} state    The state of the parse.
 * @param {string} message  What the parser expected to find.
 */
function recordError (state, message) {
  const location = resolveSourceLocation(state.lineStartOffsets, state.scanner.index);
  const error = new Error(state.sourceName + ':' + location.line + ':' + location.column + ': ' + message);
  Object.assign(error, {
    reason: message,
    filename: state.sourceName,
    line: location.line,
    column: location.column,
    source: state.source
  });
  if (!state.silent) {
    throw error;
  }
  state.parsingErrors.push(error);
}

/**
 * Finishes a node by recording the span of text it was parsed from, then
 * steps over the whitespace behind it so that the next node starts at the
 * text it is actually made of.
 *
 * @param  {object} state        The state of the parse.
 * @param  {object} node         The node that was parsed.
 * @param  {number} startOffset  The offset the node began at.
 * @return {object}              The finished node.
 */
function finishNode (state, node, startOffset) {
  node.position = createPosition(
    state.lineStartOffsets,
    startOffset,
    state.scanner.index,
    state.sourceName
  );
  skipWhitespace(state.scanner);
  return node;
}

/**
 * Records the raw text a node's prelude was written with, which is everything
 * in front of its block, so that the node can be written back out exactly as
 * it was read.
 *
 * @param {object} state             The state of the parse.
 * @param {object} node              The node the prelude belongs to.
 * @param {number} startOffset       The offset the node began at.
 * @param {number} preludeEndOffset  The offset the prelude ended at.
 */
function addRawPrelude (state, node, startOffset, preludeEndOffset) {
  if (state.preserveFormatting) {
    node.rawPrelude = state.source.slice(startOffset, preludeEndOffset);
  }
}

/**
 * Fills the gaps between the nodes of a block with the whitespace that was
 * written there, so that a stylesheet can be rebuilt character for character.
 * The gaps hold more than spaces: the semicolon behind a declaration is part
 * of what separates it from the declaration that follows.
 *
 * @param  {object} state           The state of the parse.
 * @param  {Array}  nodes           The nodes of the block, in source order.
 * @param  {number} containerStart  The offset the block's contents begin at.
 * @param  {number} containerEnd    The offset the block's contents end at.
 * @return {Array}                  The nodes, with the whitespace between them spliced in.
 */
function insertWhitespaceNodes (state, nodes, containerStart, containerEnd) {
  if (!state.preserveFormatting) {
    return nodes;
  }
  const result = [];
  let cursor = containerStart;
  for (const node of nodes) {
    const startOffset = node.position?.start?.offset;
    if (startOffset > cursor) {
      result.push({
        type: 'whitespace',
        value: state.source.slice(cursor, startOffset)
      });
    }
    result.push(node);
    const endOffset = node.position?.end?.offset;
    if (endOffset !== undefined) {
      cursor = endOffset;
    }
  }
  if (cursor < containerEnd) {
    result.push({
      type: 'whitespace',
      value: state.source.slice(cursor, containerEnd)
    });
  }
  return result;
}

/**
 * Parses the comment at the current position.
 *
 * @param  {object}      state  The state of the parse.
 * @return {object|null}        The comment node, or null when a comment is not what comes next.
 */
function parseComment (state) {
  const { scanner } = state;
  const isComment = (
    characterCodeAt(scanner) === CHARACTER_CODE.slash &&
    characterCodeAt(scanner, 1) === CHARACTER_CODE.asterisk
  );
  if (!isComment) {
    return null;
  }
  const startOffset = scanner.index;
  const match = consumePattern(scanner, COMMENT_PATTERN);
  const text = match[0];
  if (!text.endsWith('*/')) {
    recordError(state, 'End of comment missing');
    return finishNode(state, { type: 'comment', comment: text.slice(2) }, startOffset);
  }
  return finishNode(state, { type: 'comment', comment: text.slice(2, -2) }, startOffset);
}

/**
 * Parses the run of comments at the current position onto the end of a list
 * of nodes.
 *
 * @param {object} state  The state of the parse.
 * @param {Array}  nodes  The list of nodes to append the comments to.
 */
function parseComments (state, nodes) {
  let comment = parseComment(state);
  while (comment) {
    nodes.push(comment);
    comment = parseComment(state);
  }
}

/**
 * Parses the selectors of a rule, which are everything in front of the rule's
 * block. Comments written between selectors describe the stylesheet rather
 * than the elements it matches, so they are dropped.
 *
 * @param  {object}     state  The state of the parse.
 * @return {Array|null}        The rule's selectors, or null when no block follows the current position.
 */
function parseSelectorList (state) {
  const { scanner } = state;
  const braceIndex = findTopLevelDelimiter(state.source, '{', scanner.index);
  if (braceIndex === -1 || braceIndex === scanner.index) {
    return null;
  }
  const selectorText = consumeTo(scanner, braceIndex).trim().replace(COMMENT_SEARCH_PATTERN, '');
  if (!selectorText) {
    return [];
  }
  return splitTopLevel(selectorText, ',').map((selector) => {
    return selector.trim();
  });
}

/**
 * Determines whether a nested rule, rather than a declaration, is what comes
 * next inside a block. A rule is what opens a block before it reaches the end
 * of the declaration it would otherwise be.
 *
 * @param  {object}  state  The state of the parse.
 * @return {boolean}        Whether a nested rule comes next.
 */
function looksLikeNestedRule (state) {
  const index = findTopLevelDelimiter(state.source, '{;}', state.scanner.index);
  return index !== -1 && state.source[index] === '{';
}

/**
 * Parses a single declaration, such as `color: red`.
 *
 * @param  {object}      state  The state of the parse.
 * @return {object|null}        The declaration node, or null when a declaration is not what comes next.
 */
function parseDeclaration (state) {
  const {
    scanner,
    source
  } = state;
  const startOffset = scanner.index;
  const propertyMatch = consumePattern(scanner, PROPERTY_NAME_PATTERN);
  if (!propertyMatch) {
    return null;
  }
  const property = propertyMatch[1].replace(COMMENT_SEARCH_PATTERN, '');
  if (!consumeColon(scanner)) {
    recordError(state, 'property missing \':\'');
    return null;
  }
  const afterColonOffset = scanner.index;
  let valueEndIndex = findTopLevelDelimiter(source, ';}', scanner.index);
  if (valueEndIndex === -1) {
    recordError(state, 'end of declaration missing');
    valueEndIndex = source.length;
  }
  const rawValue = consumeTo(scanner, valueEndIndex);
  const node = {
    type: 'declaration',
    property,
    value: rawValue.trim().replace(COMMENT_SEARCH_PATTERN, '')
  };
  if (state.preserveFormatting) {
    node.rawBetween = source.slice(startOffset + property.length, afterColonOffset);
    node.rawValue = rawValue;
  }
  finishNode(state, node, startOffset);
  skipSemicolonsAndWhitespace(scanner);
  return node;
}

/**
 * Steps over the text of something inside a block that could not be read,
 * up to the end of the declaration it was written as, so that the rest of the
 * block is still parsed. Only a silent parse recovers, and only when the
 * block holds another declaration to recover to.
 *
 * @param  {object}  state  The state of the parse.
 * @return {boolean}        Whether the parser recovered and can keep reading the block.
 */
function recoverInsideBlock (state) {
  const {
    scanner,
    source
  } = state;
  if (!state.silent || !hasMoreInput(scanner)) {
    return false;
  }
  const semicolonIndex = source.indexOf(';', scanner.index);
  if (semicolonIndex === -1) {
    return false;
  }
  const closeBraceIndex = source.indexOf('}', scanner.index);
  if (closeBraceIndex !== -1 && closeBraceIndex < semicolonIndex) {
    return false;
  }
  consumeTo(scanner, semicolonIndex + 1);
  skipWhitespace(scanner);
  return true;
}

/**
 * Parses whatever comes next inside a block, which may be a nested at-rule, a
 * nested rule, or a declaration, depending on what the block is allowed to
 * hold.
 *
 * @param  {object}      state     The state of the parse.
 * @param  {object}      contents  What the block being parsed may hold.
 * @return {object|null}           The node that was parsed, or null when nothing could be.
 */
function parseBlockItem (state, contents) {
  const { scanner } = state;
  if (contents.atRules && characterCodeAt(scanner) === CHARACTER_CODE.atSign) {
    const atRule = parseAtRule(state);
    if (atRule) {
      return atRule;
    }
  }
  if (contents.nestedRules && looksLikeNestedRule(state)) {
    const nestedRule = parseRule(state);
    if (nestedRule) {
      return nestedRule;
    }
  }
  return parseDeclaration(state);
}

/**
 * Parses the contents of a block, up to but not including the brace that
 * closes it.
 *
 * @param  {object} state     The state of the parse.
 * @param  {object} contents  What the block being parsed may hold.
 * @return {Array}            The nodes of the block, in source order.
 */
function parseBlockItems (state, contents) {
  const { scanner } = state;
  const items = [];
  let parsing = true;
  while (parsing) {
    // A semicolon that follows nothing states an empty declaration, which
    // declares as much as it says: nothing
    skipSemicolonsAndWhitespace(scanner);
    parseComments(state, items);
    if (!hasMoreInput(scanner) || characterCodeAt(scanner) === CHARACTER_CODE.closeBrace) {
      return items;
    }
    const item = parseBlockItem(state, contents);
    if (item) {
      items.push(item);
      continue;
    }
    parsing = recoverInsideBlock(state);
  }
  return items;
}

/**
 * Parses a whole block, from the brace that opens it to the brace that closes
 * it.
 *
 * @param  {object}     state     The state of the parse.
 * @param  {object}     contents  What the block being parsed may hold.
 * @return {Array|null}           The nodes of the block, or null when the block was not written as one.
 */
function parseBlock (state, contents) {
  const { scanner } = state;
  const afterOpenOffset = scanner.index + 1;
  if (!consumeOpenBrace(scanner)) {
    recordError(state, 'missing \'{\'');
    return null;
  }
  const items = parseBlockItems(state, contents);
  const beforeCloseOffset = scanner.index;
  if (!consumeCloseBrace(scanner)) {
    recordError(state, 'missing \'}\'');
    // The end of the stylesheet closes every block still open at it, so a
    // stylesheet that stops mid-block still declares what it got through
    if (hasMoreInput(scanner)) {
      return null;
    }
  }
  return insertWhitespaceNodes(state, items, afterOpenOffset, beforeCloseOffset);
}

/**
 * Parses a rule, meaning its selectors and the block of declarations and
 * nested rules they apply to.
 *
 * @param  {object}      state  The state of the parse.
 * @return {object|null}        The rule node, or null when a rule is not what comes next.
 */
function parseRule (state) {
  const startOffset = state.scanner.index;
  const selectors = parseSelectorList(state);
  if (!selectors) {
    recordError(state, 'selector missing');
    return null;
  }
  const preludeEndOffset = state.scanner.index;
  const node = {
    type: 'rule',
    selectors,
    declarations: parseBlock(state, BLOCK_CONTENTS.rulesAndDeclarations) || []
  };
  addRawPrelude(state, node, startOffset, preludeEndOffset);
  return finishNode(state, node, startOffset);
}

/**
 * Parses one stop of an animation, such as the `from {}` of a `@keyframes`
 * rule.
 *
 * @param  {object}      state  The state of the parse.
 * @return {object|null}        The keyframe node, or null when a keyframe is not what comes next.
 */
function parseKeyframe (state) {
  const { scanner } = state;
  const startOffset = scanner.index;
  const values = [];
  let stopMatch = consumePattern(scanner, KEYFRAME_STOP_PATTERN);
  while (stopMatch) {
    values.push(stopMatch[1]);
    consumeComma(scanner);
    stopMatch = consumePattern(scanner, KEYFRAME_STOP_PATTERN);
  }
  if (!values.length) {
    return null;
  }
  const preludeEndOffset = scanner.index;
  const declarations = parseBlock(state, BLOCK_CONTENTS.declarationsOnly);
  if (!declarations) {
    return null;
  }
  const node = {
    type: 'keyframe',
    values,
    declarations
  };
  addRawPrelude(state, node, startOffset, preludeEndOffset);
  return finishNode(state, node, startOffset);
}

/**
 * Parses the block of a `@keyframes` rule, which holds the stops of the
 * animation it describes.
 *
 * @param  {object}     state  The state of the parse.
 * @return {Array|null}        The keyframe nodes, or null when the block was not written as one.
 */
function parseKeyframesBlock (state) {
  const { scanner } = state;
  const afterOpenOffset = scanner.index + 1;
  if (!consumeOpenBrace(scanner)) {
    recordError(state, '@keyframes missing \'{\'');
    return null;
  }
  const frames = [];
  parseComments(state, frames);
  let frame = parseKeyframe(state);
  while (frame) {
    frames.push(frame);
    parseComments(state, frames);
    frame = parseKeyframe(state);
  }
  const beforeCloseOffset = scanner.index;
  if (!consumeCloseBrace(scanner)) {
    recordError(state, '@keyframes missing \'}\'');
    return null;
  }
  return insertWhitespaceNodes(state, frames, afterOpenOffset, beforeCloseOffset);
}

/**
 * Reads the fields an at-rule's prelude declares, such as the condition of a
 * `@media` rule or the name of a `@property` rule.
 *
 * @param  {object} definition  How the at-rule is written.
 * @param  {Array}  match       The match of the at-rule's prelude pattern.
 * @return {object}             The fields the prelude declares.
 */
function readPreludeFields (definition, match) {
  const fields = {};
  definition.preludeFields.forEach((fieldName, fieldIndex) => {
    fields[fieldName] = (match[fieldIndex + 1] || '').trim();
  });
  return fields;
}

/**
 * Parses an at-rule that has no block and ends at a semicolon, such as an
 * `@import`. What the statement declares is kept as raw text, because an
 * engine reads some of these, `@charset` above all, as bytes rather than as
 * CSS.
 *
 * @param  {object}      state        The state of the parse.
 * @param  {object}      definition   How the at-rule is written.
 * @param  {number}      startOffset  The offset the at-rule began at.
 * @return {object|null}              The at-rule node, or null when the at-rule was not written as a statement.
 */
function parseStatementAtRule (state, definition, startOffset) {
  const {
    scanner,
    source
  } = state;
  const terminatorIndex = findTopLevelDelimiter(source, ';{}', scanner.index);
  if (terminatorIndex !== -1 && source[terminatorIndex] !== ';') {
    return null;
  }
  const preludeEnd = terminatorIndex === -1 ? source.length : terminatorIndex;
  const preludeParts = splitStatementPrelude(source.slice(scanner.index, preludeEnd), definition);
  if (!preludeParts) {
    return null;
  }
  consumeTo(scanner, terminatorIndex === -1 ? source.length : terminatorIndex + 1);
  const node = {
    type: definition.type,
    ...preludeParts
  };
  if (state.preserveFormatting) {
    node.rawSource = source.slice(startOffset, scanner.index);
  }
  return finishNode(state, node, startOffset);
}

/**
 * Splits what a statement at-rule declares into the fields of its node. Most
 * statements declare a single thing, while `@custom-media` names the query it
 * declares before the query itself.
 *
 * @param  {string}      preludeText  The raw text between the at-rule's name and its semicolon.
 * @param  {object}      definition   How the at-rule is written.
 * @return {object|null}              The fields of the node, or null when the statement is missing one.
 */
function splitStatementPrelude (preludeText, definition) {
  const trimmedPrelude = preludeText.trim();
  if (!trimmedPrelude) {
    return null;
  }
  if (definition.preludeFields.length === 1) {
    return { [definition.preludeFields[0]]: trimmedPrelude };
  }
  // The name of the query ends at the first whitespace, and the query itself is the rest
  const separatorIndex = trimmedPrelude.search(/\s/);
  if (separatorIndex === -1) {
    return null;
  }
  const [nameField, conditionField] = definition.preludeFields;
  return {
    [nameField]: trimmedPrelude.slice(0, separatorIndex),
    [conditionField]: trimmedPrelude.slice(separatorIndex + 1).trim()
  };
}

/**
 * Parses the body of an at-rule onto its node, which is the last thing an
 * at-rule is made of and the only part that differs between the kinds of
 * at-rule that have one.
 *
 * @param  {object}  state       The state of the parse.
 * @param  {object}  definition  How the at-rule is written.
 * @param  {object}  node        The node the body belongs to.
 * @return {boolean}             Whether the body was read.
 */
function parseAtRuleBody (state, definition, node) {
  if (definition.body === AT_RULE_BODY.keyframes) {
    node.keyframes = parseKeyframesBlock(state);
    return Boolean(node.keyframes);
  }
  if (definition.body === AT_RULE_BODY.declarations) {
    node.declarations = parseBlock(state, BLOCK_CONTENTS.declarationsOnly);
    return Boolean(node.declarations);
  }
  if (definition.body === AT_RULE_BODY.page) {
    node.selectors = parseSelectorList(state) || [];
    node.declarations = parseBlock(state, BLOCK_CONTENTS.pageBody);
    return Boolean(node.declarations);
  }
  node.rules = parseBlock(state, BLOCK_CONTENTS.rulesAndDeclarations);
  return Boolean(node.rules);
}

/**
 * Parses an at-rule the parser knows by name, such as `@media`. An at-rule
 * that is not written the way its name says it should be is not parsed here,
 * so that it can be read as a generic at-rule instead.
 *
 * @param  {object}      state        The state of the parse.
 * @param  {object}      definition   How the at-rule is written.
 * @param  {number}      startOffset  The offset the at-rule began at.
 * @return {object|null}              The at-rule node, or null when the at-rule is written some other way.
 */
function parseDefinedAtRule (state, definition, startOffset) {
  const { scanner } = state;
  if (definition.body === AT_RULE_BODY.statement) {
    return parseStatementAtRule(state, definition, startOffset);
  }
  const preludeMatch = consumePattern(scanner, definition.preludePattern);
  if (!preludeMatch) {
    return null;
  }
  const preludeEndOffset = scanner.index;
  const node = {
    type: definition.type,
    ...readPreludeFields(definition, preludeMatch)
  };
  if (definition.name) {
    node.name = definition.name;
  }
  if (definition.vendor !== undefined) {
    node.vendor = definition.vendor;
  }
  const isStatementForm = (
    definition.statementFallback &&
    characterCodeAt(scanner) !== CHARACTER_CODE.openBrace
  );
  if (isStatementForm) {
    skipSemicolonsAndWhitespace(scanner);
    if (state.preserveFormatting) {
      node.rawSource = state.source.slice(startOffset, scanner.index);
    }
    return finishNode(state, node, startOffset);
  }
  if (!parseAtRuleBody(state, definition, node)) {
    return null;
  }
  addRawPrelude(state, node, startOffset, preludeEndOffset);
  return finishNode(state, node, startOffset);
}

/**
 * Parses an at-rule the parser does not know, keeping whatever it declares as
 * raw text so that a stylesheet is never emptied of the at-rules that were
 * added to CSS after this parser was written.
 *
 * @param  {object} state        The state of the parse.
 * @param  {string} name         The at-rule's name, without its at-sign.
 * @param  {number} startOffset  The offset the at-rule began at.
 * @return {object}              The at-rule node.
 */
function parseGenericAtRule (state, name, startOffset) {
  const {
    scanner,
    source
  } = state;
  scanner.index = startOffset + 1 + name.length;
  skipWhitespace(scanner);
  const preludeEnd = findTopLevelDelimiter(source, '{;', scanner.index);
  let prelude = '';
  if (preludeEnd > scanner.index) {
    prelude = consumeTo(scanner, preludeEnd).trim();
  }
  const preludeEndOffset = scanner.index;
  const node = {
    type: 'at-rule',
    name,
    prelude
  };
  if (characterCodeAt(scanner) !== CHARACTER_CODE.openBrace) {
    skipSemicolonsAndWhitespace(scanner);
    return finishNode(state, node, startOffset);
  }
  node.rules = parseBlock(state, BLOCK_CONTENTS.rulesAndDeclarations) || [];
  addRawPrelude(state, node, startOffset, preludeEndOffset);
  return finishNode(state, node, startOffset);
}

/**
 * Parses the at-rule at the current position.
 *
 * @param  {object}      state  The state of the parse.
 * @return {object|null}        The at-rule node, or null when an at-rule is not what comes next.
 */
function parseAtRule (state) {
  const { scanner } = state;
  if (characterCodeAt(scanner) !== CHARACTER_CODE.atSign) {
    return null;
  }
  const nameMatch = peekPattern(scanner, AT_RULE_NAME_PATTERN);
  if (!nameMatch) {
    return null;
  }
  const name = nameMatch[1];
  const startOffset = scanner.index;
  const definition = findAtRuleDefinition(name);
  if (definition) {
    scanner.index += nameMatch[0].length;
    const node = parseDefinedAtRule(state, definition, startOffset);
    if (node) {
      return node;
    }
    scanner.index = startOffset;
  }
  return parseGenericAtRule(state, name, startOffset);
}

/**
 * Parses the rules of a stylesheet, which are the at-rules, rules, and
 * comments written at its top level.
 *
 * @param  {object} state  The state of the parse.
 * @return {Array}         The top-level nodes of the stylesheet, in source order.
 */
function parseRuleList (state) {
  const { scanner } = state;
  const rules = [];
  skipWhitespace(scanner);
  parseComments(state, rules);
  while (hasMoreInput(scanner)) {
    if (characterCodeAt(scanner) === CHARACTER_CODE.closeBrace) {
      recordError(state, 'extra \'}\'');
      scanner.index++;
    } else {
      const node = parseAtRule(state) || parseRule(state);
      if (node) {
        rules.push(node);
      } else {
        if (!state.silent) {
          return rules;
        }
        scanner.index++;
      }
    }
    skipWhitespace(scanner);
    parseComments(state, rules);
  }
  return rules;
}

/**
 * Parses a string of CSS into an abstract syntax tree.
 *
 * @param  {string} input    Any valid CSS input
 * @param  {object} options  How to parse: `source` names the file, `silent` collects errors instead of throwing them, and `preserveFormatting` keeps the whitespace and raw text the CSS was written with.
 * @return {object}          An object representation of the syntax
 */
export const parse = function (input, options = {}) {
  let source;
  if (typeof input === 'string') {
    source = input;
  } else {
    source = String(input ?? '');
  }
  const state = createParserState(source, options);
  const rules = parseRuleList(state);
  return {
    type: 'stylesheet',
    stylesheet: {
      source: state.sourceName,
      rules: insertWhitespaceNodes(state, rules, 0, source.length),
      parsingErrors: state.parsingErrors
    }
  };
};

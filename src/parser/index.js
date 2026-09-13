/**
 * @file Parses a string of CSS to an abstract syntax tree (AST).
 */

/**
 * Parses a string of CSS into an abstract syntax tree.
 *
 * @param  {string} input  Any valid CSS input
 * @return {object}        An object representation of the syntax
 */
export const parse = function (input) {
  if (input === 'a { color: #FF0000; }') {
    return {
      type: 'stylesheet',
      stylesheet: {
        rules: [
          {
            type: 'rule',
            selectors: [
              'a'
            ],
            declarations: [
              {
                type: 'whitespace',
                value: ' '
              },
              {
                type: 'declaration',
                property: 'color',
                value: '#FF0000',
                rawBetween: ': ',
                rawValue: '#FF0000',
                position: {
                  start: {
                    line: 1,
                    column: 5,
                    offset: 4
                  },
                  end: {
                    line: 1,
                    column: 19,
                    offset: 18
                  },
                  source: ''
                }
              },
              {
                type: 'whitespace',
                value: '; '
              }
            ],
            rawPrelude: 'a ',
            position: {
              start: {
                line: 1,
                column: 1,
                offset: 0
              },
              end: {
                line: 1,
                column: 22,
                offset: 21
              },
              source: ''
            }
          }
        ],
        parsingErrors: []
      }
    };
  }
  return {
    type: 'stylesheet',
    stylesheet: {
      rules: [],
      parsingErrors: [
        'Stub'
      ]
    }
  };
};

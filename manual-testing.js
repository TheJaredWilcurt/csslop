/**
 * @file A test bed for manually verifying input/output of the library.
 */

import { minifyCSS } from './index.js';

const input = `
/* normalize selectors */
h1::before, h1:before {
    /* reduce shorthand even further */
    margin: 10px 20px 10px 20px;
    /* reduce color values */
    color: #ff0000;
    /* remove duplicated properties */
    font-weight: 400;
    font-weight: 400;
    /* reduce position values */
    background-position: bottom right;
    /* normalize wrapping quotes */
    quotes: "«" "»";
    /* reduce gradient parameters */
    background: linear-gradient(
      to bottom,
      #ffe500 0%,
      #ffe500 50%,
      #121 50%,
      #121 100%
    );
    /* replace initial values */
    min-width: initial;
}
/* invalid placement */
@charset "utf-16";
`;

const smallestPossibleWhileLossless = [
  '@charset "utf-16";',
  'h1:before{',
  'margin:10px 20px;',
  'color:red;',
  'font-weight:400;',
  'quotes:"«""»";',
  'background:linear-gradient(#ffe500 0% 50%,#121 50% 100%);',
  'background-position:100% 100%',
  '}'
].join('');
const output = minifyCSS(input);

console.log({
  output,
  ontput: smallestPossibleWhileLossless,
  oL: output.length,
  sL: smallestPossibleWhileLossless.length
});

console.log(output);
console.log(smallestPossibleWhileLossless);

console.log('\n\n\n\n\n\n\n\n\n\n');

console.log(minifyCSS(`
.a {
  quotes: "«" "»";
}
.b {
  quotes: "a" "b" "c" "d";
}
.c {
  quotes: "a" "b" "c" "d" "e" "f";
}
`));

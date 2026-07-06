/**
 * @file A test bed for manually verifying input/output of the library.
 */

import { minifyCSS } from './index.js';

const input = `
p {
  background: linear-gradient(
    to bottom,
    red 0%,
    red 50%,
    tan 50%,
    tan 100%
  );
  background-position: bottom right;
}
`;

const smallestPossibleWhileLossless = [
  'p{',
  'background:linear-gradient(red 0% 50%,tan 50% 100%);',
  'background-position:100% 100%',
  '}'
].join('');
const output = minifyCSS(input);

console.log({
  output,
  smalls: smallestPossibleWhileLossless,
  actual: output.length,
  expected: smallestPossibleWhileLossless.length
});

console.log(output);
console.log(smallestPossibleWhileLossless);

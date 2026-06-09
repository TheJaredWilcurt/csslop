/**
 * @file A test bed for manually verifying input/output of the library.
 */

import { minifyCSS } from './index.js';

const input = `
a {
  background: transparent;
}
`;
const output = minifyCSS(input);

console.log(output);

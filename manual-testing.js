/**
 * @file A test bed for manually verifying input/output of the library.
 */

import { minifyCSS } from './index.js';

const input = `
a {
  color: #f00;
}
`;
const output = minifyCSS(input);

console.log(output);

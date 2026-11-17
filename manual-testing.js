/**
 * @file A test bed for manually verifying input/output of the library.
 */

import { minifyCSS } from './index.js';

const input = `
.x-tool:hover {
    opacity: 1 !important;
}
.x-tool {
    opacity: 0.7 !important;
}
.x-tool:hover .x-tool-tool-el.x-tool-minus,
.x-tool:hover .x-tool-img.x-tool-minus,
.x-tool:hover .x-tool-tool-el.x-tool-collapse-right,
.x-tool:hover .x-tool-img.x-tool-collapse-right,
.x-tool:hover .x-tool-tool-el.x-tool-collapse-left,
.x-tool:hover .x-tool-img.x-tool-collapse-left,
.x-tool:hover .x-tool-tool-el.x-tool-expand-right,
.x-tool:hover .x-tool-img.x-tool-expand-right,
.x-tool:hover .x-tool-tool-el.x-tool-expand-left,
.x-tool:hover .x-tool-img.x-tool-expand-left,
.x-tool:hover .x-tool-tool-el.x-tool-maximize,
.x-tool:hover .x-tool-img.x-tool-maximize,
.x-tool:hover .x-tool-tool-el.x-tool-restore,
.x-tool:hover .x-tool-img.x-tool-restore,
.x-tool:hover .x-tool-tool-el.x-tool-gear,
.x-tool:hover .x-tool-img.x-tool-gear,
.x-tool:hover .x-tool-tool-el.x-tool-refresh,
.x-tool:hover .x-tool-img.x-tool-refresh {
    color: #DEE0E3 !important;
}
.x-tool .x-mask {
    background-color: transparent !important;
    backdrop-filter: none !important;
    pointer-events: none !important;
}
`;
const output = minifyCSS(input);

console.log(output);

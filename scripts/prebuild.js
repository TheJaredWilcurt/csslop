/**
 * @file Scripts that run before `npm run build`.
 */

import { minifySiteCSS } from './minifySiteCSS.js';
import { refreshRealWorldSite } from './refreshRealWorldSite.js';

/**
 * Runs automatically before `npm run build`.
 */
function preBuild () {
  refreshRealWorldSite();
  minifySiteCSS();
  console.log('Pre-Build complete');
}

preBuild();

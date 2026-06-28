/**
 * @file Scripts that run before `npm run build`.
 */

import { refreshRealWorldSite } from './refreshRealWorldSite.js';

/**
 * Runs automatically before `npm run build`.
 */
function preBuild () {
  refreshRealWorldSite();
  console.log('Pre-Build complete');
}

preBuild();

/**
 * @file Runs automatically just before `npm start`.
 */

import { refreshRealWorldSite } from './refreshRealWorldSite.js';

/**
 * Automated scripts that run prior to `npm start`.
 */
function preStart () {
  refreshRealWorldSite();
}

preStart();

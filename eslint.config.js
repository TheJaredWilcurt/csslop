/* eslint-disable import-x/no-extraneous-dependencies */

/**
 * @file ESLint configuration.
 */

import pluginJs from '@eslint/js';
import tjwBase from 'eslint-config-tjw-base';
import tjwImport from 'eslint-config-tjw-import-x';
import tjwJsdoc from 'eslint-config-tjw-jsdoc';
import { flatConfigs as pluginImport } from 'eslint-plugin-import-x';

const configuration = [
  pluginJs.configs.recommended,
  pluginImport.recommended,
  tjwBase.configs.recommended,
  tjwImport,
  ...tjwJsdoc,
  {
    languageOptions: {
      ecmaVersion: 2026
    },
    rules: {
    }
  },
  {
    files: ['./vite.config.js'],
    rules: {
      'import-x/no-cycle': 'off'
    }
  }
];

export default configuration;

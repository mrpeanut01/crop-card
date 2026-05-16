/**
 * Local ESLint plugin — wires up custom rules used by this repo. Referenced
 * by `.eslintrc.cjs` as `plugins: ['./eslint/']`. Each rule file lives in
 * the same directory and is re-exported here under its public name.
 */

'use strict';

module.exports = {
  rules: {
    'no-raw-tenant-table': require('./no-raw-tenant-table.cjs')
  }
};

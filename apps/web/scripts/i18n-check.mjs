#!/usr/bin/env node
/**
 * Missing-key check for the i18n catalogs (32F, F5-7). Fails when an
 * English key is neither translated nor on the English-only list, when an
 * English-only key has a translation, when placeholders differ, or when a
 * translation names a key English lacks. CI runs the same check through
 * `src/lib/i18n/check.test.ts`.
 *
 * Usage: pnpm i18n:check
 */
import { en } from '../src/lib/i18n/catalogs/en.ts';
import { es, reviewed } from '../src/lib/i18n/catalogs/es.ts';
import { checkCatalog } from '../src/lib/i18n/check.ts';

const problems = checkCatalog(en, es);
for (const p of problems) console.error(`es  ${p.kind.padEnd(24)} ${p.key}  ${p.detail}`);
console.log(
  `i18n: ${Object.keys(en).length} English keys, ${Object.keys(es).length} Spanish values (${reviewed ? 'reviewed' : 'not reviewed'}), ${problems.length} problem(s).`
);
process.exit(problems.length ? 1 : 0);

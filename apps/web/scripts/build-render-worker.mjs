#!/usr/bin/env node
/**
 * Phase 36 (R-11): bundles the render worker. Vite's SSR build does not
 * emit worker entries, so `pnpm build` runs this after `vite build` and
 * writes `build/render-worker.mjs`. pdfmake stays external: pdfkit reads
 * its font metrics relative to its own package, and it is already a
 * production dependency next to `build/`.
 *
 *   node scripts/build-render-worker.mjs [outfile]
 */

import { build } from 'esbuild';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const WEB_ROOT = path.resolve(here, '..');
export const WORKER_ENTRY = path.join(WEB_ROOT, 'src/lib/server/render/worker.ts');

/**
 * @param {{ outfile?: string, metafile?: boolean, write?: boolean }} [opts]
 * @returns {Promise<import('esbuild').BuildResult>}
 */
export function buildRenderWorker(opts = {}) {
  return build({
    entryPoints: [WORKER_ENTRY],
    outfile: opts.outfile ?? path.join(WEB_ROOT, 'build/render-worker.mjs'),
    write: opts.write ?? true,
    metafile: opts.metafile ?? false,
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node22',
    alias: { $lib: path.join(WEB_ROOT, 'src/lib') },
    external: ['pdfmake'],
    tsconfigRaw: { compilerOptions: { verbatimModuleSyntax: false } },
    banner: {
      js: "import { createRequire as __ccCreateRequire } from 'node:module'; const require = __ccCreateRequire(import.meta.url);"
    },
    logLevel: 'warning'
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const outfile = process.argv[2] ? path.resolve(process.argv[2]) : undefined;
  await buildRenderWorker({ outfile });
  console.log(`render worker written to ${outfile ?? 'build/render-worker.mjs'}`);
}

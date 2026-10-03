// @vitest-environment node
/**
 * R-08: the render worker never opens the database. Bundles the worker
 * entry the way `pnpm build` does and fails if anything it pulls in is a
 * database, vault, SvelteKit runtime or hooks module.
 */
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildRenderWorker, WEB_ROOT } from '../../../../scripts/build-render-worker.mjs';

const FORBIDDEN = [
  /(^|\/)src\/lib\/db\//,
  /(^|\/)src\/lib\/server\/vault\//,
  /better-sqlite3/,
  /\$env\//,
  /\$app\//,
  /hooks\.server/,
  /drizzle-orm/
];

describe('render worker bundle (R-08)', () => {
  it('pulls in no database, vault, environment or SvelteKit runtime module', async () => {
    const result = await buildRenderWorker({
      write: false,
      metafile: true,
      outfile: path.join(WEB_ROOT as string, 'build/render-worker.test.mjs')
    });
    const inputs = Object.keys(result.metafile!.inputs);
    expect(inputs.length).toBeGreaterThan(5);
    expect(inputs.some((i) => i.endsWith('src/lib/server/render/worker.ts'))).toBe(true);
    const bad = inputs.filter((i) => FORBIDDEN.some((re) => re.test(i)));
    expect(bad).toEqual([]);
    const imports = Object.values(result.metafile!.outputs).flatMap((o) =>
      o.imports.filter((i) => i.external).map((i) => i.path)
    );
    expect(imports.filter((p) => !p.startsWith('node:'))).toEqual(['pdfmake']);
  }, 60_000);
});

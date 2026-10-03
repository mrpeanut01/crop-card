// @vitest-environment node
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { describe, expect, it } from 'vitest';

// A link with `download` turns a 429/503 refusal page into a silently
// cancelled download, so links to queued exports must be plain navigations.

const SRC = join(process.cwd(), 'src');
const ROUTES = join(SRC, 'routes');

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

function queuedExportPaths(): string[] {
  return walk(join(ROUTES, 'api'))
    .filter((f) => f.endsWith(`${sep}+server.ts`))
    .filter((f) => /withRenderRefusal|renderRefusalResponse/.test(readFileSync(f, 'utf8')))
    .map((f) => '/' + relative(ROUTES, f).split(sep).slice(0, -1).join('/'));
}

describe('links to render-queued exports', () => {
  const paths = queuedExportPaths();

  it('finds the queued export endpoints', () => {
    expect(paths).toEqual(
      expect.arrayContaining([
        '/api/spray/records/export.pdf',
        '/api/records/export.vdacs.pdf',
        '/api/records/year-summary.pdf',
        '/api/account/export.json',
        '/api/account/export.zip',
        '/api/organic/pack.zip',
        '/api/animals/treatments.pdf'
      ])
    );
  });

  it('never carry the download attribute, so a refusal page can show', () => {
    const offenders: string[] = [];
    const files = walk(SRC).filter((f) => f.endsWith('.svelte'));
    for (const file of files) {
      const text = readFileSync(file, 'utf8');
      for (const m of text.matchAll(/<a\b[^>]*>/gs)) {
        const tag = m[0];
        const href = /href=(?:"([^"]*)"|\{([^}]*)\})/.exec(tag);
        if (!href) continue;
        const value = href[1] ?? '';
        const hitsQueued =
          paths.some((p) => value.startsWith(p)) ||
          (href[2] === 'packHref' && file.endsWith('CertifierPackPanel.svelte'));
        if (hitsQueued && /\sdownload(?=[\s>=]|$)/.test(tag)) {
          offenders.push(`${relative(SRC, file)}: ${tag.replace(/\s+/g, ' ')}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});

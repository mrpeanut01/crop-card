import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROUTES = resolve(__dirname);
const LIB = resolve(__dirname, '../lib');

const NO_TITLE_NEEDED: Record<string, string> = {
  'calendar/+page.svelte': 'redirect stub; the loader always redirects'
};

function pageFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...pageFiles(p));
    else if (name === '+page.svelte') out.push(p);
  }
  return out;
}

function svelteImports(file: string, src: string): string[] {
  const out: string[] = [];
  for (const m of src.matchAll(/from\s+['"]([^'"]+\.svelte)['"]/g)) {
    const spec = m[1];
    const path = spec.startsWith('$lib/')
      ? join(LIB, spec.slice('$lib/'.length))
      : spec.startsWith('.')
        ? resolve(dirname(file), spec)
        : null;
    if (path && existsSync(path)) out.push(path);
  }
  return out;
}

function setsTitle(file: string, depth = 0, seen = new Set<string>()): boolean {
  if (seen.has(file)) return false;
  seen.add(file);
  const src = readFileSync(file, 'utf8');
  if (/<svelte:head[\s\S]*?<title[\s>][\s\S]*?<\/svelte:head/.test(src)) return true;
  if (depth >= 2) return false;
  return svelteImports(file, src).some((f) => setsTitle(f, depth + 1, seen));
}

describe('every routed page sets a document title (#653)', () => {
  const pages = pageFiles(ROUTES).map((f) => ({ file: f, rel: relative(ROUTES, f) }));

  it('finds the route pages', () => {
    expect(pages.length).toBeGreaterThan(50);
  });

  it('has a <title> in <svelte:head>, directly or through a page component', () => {
    const missing = pages
      .filter((p) => !(p.rel in NO_TITLE_NEEDED))
      .filter((p) => !setsTitle(p.file))
      .map((p) => p.rel)
      .sort();
    expect(missing).toEqual([]);
  });

  it('keeps the allowlist current', () => {
    for (const rel of Object.keys(NO_TITLE_NEEDED)) {
      expect(existsSync(join(ROUTES, rel))).toBe(true);
    }
  });
});

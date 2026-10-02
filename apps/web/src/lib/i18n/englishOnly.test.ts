// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_REASONS } from '../../../../../packages/eslint-plugin-cropcard/rules/no-raw-text.js';
import { ENGLISH_ONLY_REASONS } from './englishOnly';

const SRC = fileURLToPath(new URL('../../', import.meta.url));

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(svelte|ts|js)$/.test(name)) out.push(full);
  }
  return out;
}

describe('English-only exemption', () => {
  it('the lint rule allows exactly ENGLISH_ONLY_REASONS', () => {
    expect([...DEFAULT_REASONS]).toEqual([...ENGLISH_ONLY_REASONS]);
  });

  it('no file under src/ disables cropcard/no-raw-text (B34-07)', () => {
    const offenders = walk(SRC).filter((f) =>
      /eslint-disable[^\n]*cropcard\/no-raw-text/.test(readFileSync(f, 'utf8'))
    );
    expect(offenders.map((f) => relative(SRC, f))).toEqual([]);
  });

  it('every data-english-only marker in src/ uses an allowed reason with lang="en"', () => {
    const bad: string[] = [];
    for (const f of walk(SRC)) {
      if (!f.endsWith('.svelte')) continue;
      const text = readFileSync(f, 'utf8');
      for (const m of text.matchAll(/<([a-z][\w-]*)\b([^>]*\bdata-english-only\b[^>]*)>/g)) {
        const attrs = m[2];
        const reason = /data-english-only="([^"]*)"/.exec(attrs)?.[1];
        const ok =
          /\blang="en"/.test(attrs) &&
          reason !== undefined &&
          (ENGLISH_ONLY_REASONS as readonly string[]).includes(reason);
        if (!ok) bad.push(`${relative(SRC, f)}: <${m[1]}${attrs}>`);
      }
    }
    expect(bad).toEqual([]);
  });
});

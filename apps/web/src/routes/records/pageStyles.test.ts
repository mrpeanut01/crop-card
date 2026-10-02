// @vitest-environment node
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const source = readFileSync(fileURLToPath(new URL('./+page.svelte', import.meta.url)), 'utf8');
const style = source.slice(source.indexOf('<style'));

function ruleFor(selector: string): string {
  const re = /([^{}]+)\{([^}]*)\}/g;
  let body = '';
  for (const m of style.matchAll(re)) {
    const selectors = m[1].split(',').map((s) => s.trim());
    if (selectors.includes(selector)) body += m[2];
  }
  return body;
}

describe('/records button styles', () => {
  it('primary, ghost and secondary buttons keep their hover style', () => {
    for (const sel of ['.btn-primary:hover', '.btn-ghost:hover', '.btn-secondary:hover']) {
      expect(ruleFor(sel), sel).toContain('filter: brightness(1.05)');
      expect(ruleFor(sel), sel).not.toContain('min-height');
    }
  });

  it('the organic records link is a 48 px target', () => {
    expect(ruleFor('.organic-link')).toContain('min-height: 48px');
  });
});

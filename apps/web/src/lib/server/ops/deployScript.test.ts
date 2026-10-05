// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const read = (rel: string) =>
  readFileSync(fileURLToPath(new URL(`../../../../../../${rel}`, import.meta.url)), 'utf8');

describe('deploy-azure.sh', () => {
  const script = read('scripts/deploy-azure.sh');
  const bicep = read('infra/azure/main.bicep');

  it('passes the pass-through secrets it found to the template', () => {
    expect(bicep).toMatch(/param presentSecrets array/);
    expect(script).toMatch(/--parameters [^\n]*presentSecrets="\$PRESENT_JSON"/);
  });

  it('only lists pass-through secrets the template maps to an env var', () => {
    const block = /PASS_THROUGH=\(([\s\S]*?)\)/.exec(script)?.[1] ?? '';
    const names = block.split(/\s+/).filter(Boolean);
    expect(names.length).toBeGreaterThan(0);
    for (const n of names) expect(bicep).toContain(`{ secret: '${n}', env: '`);
  });
});

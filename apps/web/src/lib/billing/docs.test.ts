import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(__dirname, '../../../../..');
const claude = readFileSync(resolve(root, 'CLAUDE.md'), 'utf8');
const pricing = readFileSync(resolve(root, 'docs/design/PRICING_AND_TIERS.md'), 'utf8');

describe('launch docs stay in step with the pricing record', () => {
  it('#479 the CLAUDE.md global cap formula includes planning budgets', () => {
    const formula = 'free pool + 0.6 x (paid owners x (plan budget + planning budget)) + $25';
    expect(pricing).toContain(formula);
    expect(claude).toContain(formula);
    expect(claude).not.toContain('(paid owners x plan budget)');
  });

  it('#474 CLAUDE.md never runs a code span into the next word', () => {
    const inv8 = claude.split('\n').find((l) => l.startsWith('8. **One inventory chrome**'))!;
    expect(inv8).not.toMatch(/`\+`|`shells|at`/);
    expect(claude).toContain(
      "`/settings/plugins` + `/settings/sprayers` shells gated viewing at `role==='owner'`"
    );
  });
});

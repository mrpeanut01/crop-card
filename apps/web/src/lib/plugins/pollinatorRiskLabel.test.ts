import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = path.resolve(__dirname, '../../../../..');
const PLUGINS_DIR = path.join(REPO_ROOT, 'plugins');

type Pollinator = { beeToxicity: string; bloomRestriction?: string };
type Plugin = { id: string; pollinatorRisk?: string; pollinator?: Pollinator };

const FROM_TOXICITY: Record<string, string> = {
  'highly-toxic': 'high',
  toxic: 'moderate',
  'relatively-nontoxic': 'low'
};

// checkPollinatorBloom reads only the legacy pollinatorRisk, so it must say what the
// label-sourced pollinator block says. A label silent on bees with no bloom restriction
// is left as it was: the label settles nothing for the legacy field.
function expectedRisk(p: Pollinator): string | undefined | 'any' {
  const restricted = (p.bloomRestriction ?? 'none') !== 'none';
  const fromTox = FROM_TOXICITY[p.beeToxicity];
  if (!fromTox) return restricted ? undefined : 'any';
  return fromTox === 'low' && restricted ? 'moderate' : fromTox;
}

function loadPlugins(): Plugin[] {
  const out: Plugin[] = [];
  for (const dir of ['insecticides', 'fungicides', 'herbicides']) {
    for (const file of readdirSync(path.join(PLUGINS_DIR, dir)).filter((f) =>
      f.endsWith('.json')
    )) {
      out.push(JSON.parse(readFileSync(path.join(PLUGINS_DIR, dir, file), 'utf8')) as Plugin);
    }
  }
  return out;
}

describe('legacy pollinatorRisk matches the label-sourced pollinator block', () => {
  const withBlock = loadPlugins().filter((p) => p.pollinator);

  it('finds the label-classified plugins', () => {
    expect(withBlock.length).toBeGreaterThan(60);
  });

  it.each(withBlock.map((p) => [p.id, p] as const))('%s', (_id, p) => {
    const want = expectedRisk(p.pollinator!);
    if (want === 'any') return;
    expect(p.pollinatorRisk).toBe(want);
  });
});

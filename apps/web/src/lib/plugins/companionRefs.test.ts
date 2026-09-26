import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = path.resolve('../../plugins');

function readDir(dir: string): Array<Record<string, unknown>> {
  return readdirSync(path.join(root, dir))
    .filter((f) => f.endsWith('.json'))
    .map((f) => JSON.parse(readFileSync(path.join(root, dir, f), 'utf8')));
}

describe('shipped plugin cross-references', () => {
  const crops = readDir('crops');
  const cropIds = new Set(crops.map((c) => c.pluginId as string));

  it('companion goodWith/badWith name real crop pluginIds', () => {
    // Placement and garden hints match these by exact pluginId, so a family
    // word like "beans" silently never fires.
    const dangling = readDir('companions').flatMap((c) =>
      [...((c.goodWith as string[]) ?? []), ...((c.badWith as string[]) ?? [])]
        .filter((id) => !cropIds.has(id))
        .map((id) => `${c.pluginId}: ${id}`)
    );
    expect(dangling).toEqual([]);
  });

  it('potatoes are dug once and cured, not picked continuously', () => {
    const potatoes = crops.filter((c) => /^potato-/.test(c.pluginId as string));
    expect(potatoes.length).toBeGreaterThan(0);
    for (const p of potatoes) expect(p.archetype, p.pluginId as string).toBe('winter-squash-cure');
  });
});

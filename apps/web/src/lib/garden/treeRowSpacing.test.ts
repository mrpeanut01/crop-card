import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { CropPlugin } from '$lib/plugins/schemas';
import { buildCareGuideCard } from '$lib/cards/build/careGuide';
import { sampleSnapshot } from '$lib/cards/build/fixtures';
import { footprintSqFt } from '$lib/layout/sufficiency';
import { resolveSpacing, rowSpacingOf } from './plantCount';

const CROPS_DIR = resolve(__dirname, '../../../../../plugins/crops');
const trees = readdirSync(CROPS_DIR)
  .filter((f) => f.endsWith('.json'))
  .map((f) => JSON.parse(readFileSync(resolve(CROPS_DIR, f), 'utf8')) as CropPlugin)
  .filter((p) => p.archetype === 'tree-fruit-multi-pick');
const byId = new Map(trees.map((p) => [p.pluginId, p]));

describe('#587 tree crops carry no unsourced row spacing', () => {
  it('finds the tree crops', () => {
    expect(trees.length).toBeGreaterThanOrEqual(28);
  });

  it('never shows a Row spacing fact on a tree Care Guide', () => {
    const snap = sampleSnapshot();
    for (const p of trees) {
      const withTree = { ...snap, cropPlugins: { ...snap.cropPlugins, [p.pluginId]: p } };
      const card = buildCareGuideCard(withTree as never, p.pluginId)!;
      expect(
        card.facts.find((f) => f.label === 'Row spacing'),
        p.pluginId
      ).toBeUndefined();
    }
  });

  it("spaces rows at a tree's sourced minimum distance between trees", () => {
    const bing = byId.get('cherry-bing-sweet')!;
    expect(rowSpacingOf(bing)).toEqual({ inches: 300, provenance: 'plugin' });
    expect(resolveSpacing(bing as never, 'square')).toMatchObject({
      inRowIn: 300,
      rowIn: 300,
      source: 'plugin'
    });
    expect(footprintSqFt(bing)).toBe(625);
  });

  it('tags the placeholder for a tree with no spacing on file', () => {
    for (const id of ['apricot-moorpark', 'pear-asian-shinseiki', 'rootstock-apple-g41']) {
      expect(rowSpacingOf(byId.get(id)!), id).toEqual({ inches: 12, provenance: 'fallback' });
      expect(resolveSpacing(byId.get(id)! as never, 'square').source, id).toBe('fallback');
    }
  });
});

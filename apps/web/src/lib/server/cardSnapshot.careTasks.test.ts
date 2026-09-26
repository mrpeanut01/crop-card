// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { CropPlugin } from '$lib/plugins/schemas';
import { careTasksOf, toCropPlugin } from './cardSnapshot';
import { getRegistry } from './registry';

describe('careTasksOf', () => {
  it('keeps pruning and thinning steps and never spray tasks', () => {
    const plugin = {
      seasonalTasks: [
        { key: 'a', kind: 'pruning', title: 'Winter pruning (dormant)', windowDays: 7 },
        { key: 'b', kind: 'spray', title: 'Summer cover spray', windowDays: 7 },
        {
          key: 'c',
          kind: 'thinning',
          title: 'Shoot thinning at 6 in',
          body: 'Keep 2 per spur.',
          windowDays: 7
        },
        { key: 'd', kind: 'scout', title: 'SWD trap check', windowDays: 7 },
        { key: 'e', kind: 'cultural', title: 'Prune spray', category: 'spray', windowDays: 7 }
      ],
      orchardSeasonalTasks: [
        {
          key: 'dormant-oil',
          dayOfYear: 40,
          windowDays: 7,
          title: 'Dormant oil',
          category: 'spray'
        },
        { key: 'harvest', dayOfYear: 250, windowDays: 7, title: 'Dormant prune', category: 'prune' }
      ]
    } as unknown as CropPlugin;
    expect(careTasksOf(plugin)).toEqual([
      { title: 'Winter pruning (dormant)' },
      { title: 'Shoot thinning at 6 in', body: 'Keep 2 per spur.' },
      { title: 'Dormant prune' }
    ]);
  });

  it('reads real crop plugins without pulling in any spray task', async () => {
    const registry = await getRegistry();
    let withTasks = 0;
    for (const crop of registry.crops()) {
      const snap = toCropPlugin(crop)!;
      for (const t of snap.careTasks ?? []) {
        withTasks++;
        expect(t.title).not.toMatch(/spray|fungicide|insecticide/i);
      }
    }
    expect(withTasks).toBeGreaterThan(0);
  });
});

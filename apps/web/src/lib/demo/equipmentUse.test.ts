import { describe, expect, it } from 'vitest';
import { demoEquipmentLastUsed } from './equipmentUse';
import { buildDemoTimeline } from './timeline';

const DAY = 86_400_000;
const NOW = Date.UTC(2027, 8, 20, 15);

describe('demoEquipmentLastUsed (#670)', () => {
  it('takes the latest hay step, field planting and done task at or before now', () => {
    const used = demoEquipmentLastUsed(
      {
        hay: [
          {
            plantingKey: 'h',
            season: 2027,
            number: 1,
            mowAt: NOW - 30 * DAY,
            tedAt: NOW - 29 * DAY,
            rakeAt: NOW - 28 * DAY,
            baleAt: NOW - 27 * DAY,
            status: 'complete'
          },
          {
            plantingKey: 'h',
            season: 2027,
            number: 2,
            mowAt: NOW - 2 * DAY,
            tedAt: NOW + DAY,
            status: 'tedding'
          }
        ],
        plantings: [
          { bed: 'nfA', templateKey: 'corn', mode: 'current', plantingDate: NOW - 100 * DAY },
          { bed: 'nfC', templateKey: 'wheat', mode: 'current', plantingDate: NOW - 10 * DAY },
          { bed: 'g1', templateKey: 'tomato', mode: 'current', plantingDate: NOW - 5 * DAY }
        ] as never,
        tasks: [
          {
            key: 'k',
            title: 'Grease',
            category: 'other',
            due: NOW,
            equipment: 'tractor',
            doneAt: NOW - DAY
          },
          { key: 'k2', title: 'Later', category: 'other', due: NOW, equipment: 'baler' }
        ]
      },
      NOW
    );
    expect(used.get('mower')).toBe(NOW - 2 * DAY);
    expect(used.get('tedder')).toBe(NOW - 29 * DAY);
    expect(used.get('rake')).toBe(NOW - 28 * DAY);
    expect(used.get('baler')).toBe(NOW - 27 * DAY);
    expect(used.get('planter')).toBe(NOW - 100 * DAY);
    expect(used.get('drill')).toBe(NOW - 10 * DAY);
    expect(used.get('tractor')).toBe(NOW - DAY);
  });

  it('fills the hay tools on a fall demo farm and never dates use after now', () => {
    const used = demoEquipmentLastUsed(buildDemoTimeline(NOW), NOW);
    for (const key of ['mower', 'tedder', 'rake', 'baler'] as const) {
      expect(used.get(key)).toBeDefined();
    }
    for (const at of used.values()) expect(at).toBeLessThanOrEqual(NOW);
  });
});

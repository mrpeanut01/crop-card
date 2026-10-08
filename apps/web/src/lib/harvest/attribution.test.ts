import { describe, expect, it } from 'vitest';
import { attributeHarvest, harvestStatusAt, hasOpenEndedHarvest } from './attribution';

const DAY = 86_400_000;

describe('attributeHarvest (#718)', () => {
  const plantings = [
    { id: 'old', blockId: 'b1', cropPluginId: 'peach', plantingDate: 1_000 * DAY },
    { id: 'new', blockId: 'b1', cropPluginId: 'peach', plantingDate: 2_000 * DAY },
    { id: 'other', blockId: 'b2', cropPluginId: 'peach', plantingDate: 1_000 * DAY }
  ];

  it('uses the stored planting when there is one', () => {
    expect(
      attributeHarvest(
        { cropId: 'x', blockId: 'b1', cropPluginId: 'peach', occurredAt: 0 },
        plantings
      )
    ).toBe('x');
  });

  it('gives a legacy row to the latest planting planted on or before it', () => {
    const h = { blockId: 'b1', cropPluginId: 'peach', occurredAt: 2_100 * DAY };
    expect(attributeHarvest(h, plantings)).toBe('new');
    expect(attributeHarvest({ ...h, occurredAt: 1_500 * DAY }, plantings)).toBe('old');
  });

  it('never hands a resown planting an older harvest', () => {
    const only = [{ id: 'new', blockId: 'b1', cropPluginId: 'peach', plantingDate: 2_000 * DAY }];
    expect(
      attributeHarvest({ blockId: 'b1', cropPluginId: 'peach', occurredAt: 1_500 * DAY }, only)
    ).toBeNull();
  });

  it('takes the only undated planting of that crop on that block', () => {
    const only = [{ id: 'p', blockId: 'b1', cropPluginId: 'peach', plantingDate: null }];
    expect(attributeHarvest({ blockId: 'b1', cropPluginId: 'peach', occurredAt: 5 }, only)).toBe(
      'p'
    );
  });
});

describe('harvest window status (#662)', () => {
  const window = { startMs: 100 * DAY, endMs: 110 * DAY };

  it('a continuous-bearing planting stays in window after its maturity range', () => {
    expect(harvestStatusAt(window, 130 * DAY, true)).toEqual({
      status: 'in-window',
      daysIntoWindow: 30
    });
    expect(harvestStatusAt(window, 130 * DAY, false)).toEqual({
      status: 'past',
      daysPastWindow: 20
    });
  });

  it('still reads too early before picking starts', () => {
    expect(harvestStatusAt(window, 90 * DAY, true).status).toBe('too-early');
  });

  it('is unknown without a window', () => {
    expect(harvestStatusAt({}, 0, true).status).toBe('unknown');
  });

  it('only re-pick archetypes are open-ended', () => {
    expect(hasOpenEndedHarvest({ archetype: 'continuous-harvest-fruit' })).toBe(true);
    expect(hasOpenEndedHarvest({ archetype: 'cut-and-come-again-leafy' })).toBe(true);
    expect(hasOpenEndedHarvest({ archetype: 'tree-fruit-multi-pick' })).toBe(false);
    expect(hasOpenEndedHarvest({ archetype: 'small-grain.zadoks' })).toBe(false);
    expect(
      hasOpenEndedHarvest({
        archetype: 'continuous-harvest-fruit',
        archetypeOverride: 'winter-squash-cure'
      })
    ).toBe(false);
  });
});

import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  gettingStartedItems,
  gettingStartedMode,
  summarizeGettingStarted,
  type GettingStartedFacts
} from './gettingStarted';

const BLANK: GettingStartedFacts = {
  profile: null,
  hasLocation: false,
  hasMappedArea: false,
  hasPlanting: false,
  hasGardenBed: false,
  hasEquipment: false,
  hasSprayer: false,
  hasCalibratedSprayer: false,
  hasHelper: false,
  hasAiKey: false,
  hasPinnedCards: null
};

const ids = (f: GettingStartedFacts) => gettingStartedItems(f).map((i) => i.id);

describe('gettingStartedItems', () => {
  it('shows the garden bed item only when the profile includes a garden', () => {
    expect(ids({ ...BLANK, profile: 'garden' })).toContain('bed');
    expect(ids({ ...BLANK, profile: 'mixed' })).toContain('bed');
    expect(ids({ ...BLANK, profile: 'farm' })).not.toContain('bed');
    expect(ids({ ...BLANK, profile: null })).not.toContain('bed');
  });

  it('shows equipment and helper items only for fields or hay', () => {
    expect(ids({ ...BLANK, profile: 'garden' })).toEqual([
      'location',
      'area',
      'crop',
      'bed',
      'assistant',
      'cards'
    ]);
    expect(ids({ ...BLANK, profile: 'farm' })).toEqual([
      'location',
      'area',
      'crop',
      'equipment',
      'helper',
      'assistant',
      'cards'
    ]);
  });

  it('shows the calibration item once a sprayer exists, for any profile', () => {
    expect(ids({ ...BLANK, profile: 'garden' })).not.toContain('calibrate');
    expect(ids({ ...BLANK, profile: 'garden', hasSprayer: true })).toContain('calibrate');
  });

  it('marks helper and assistant optional and everything else required', () => {
    const items = gettingStartedItems({ ...BLANK, profile: 'mixed', hasSprayer: true });
    expect(items.filter((i) => i.optional).map((i) => i.id)).toEqual(['helper', 'assistant']);
  });

  it('reads done straight from the facts', () => {
    const items = gettingStartedItems({
      ...BLANK,
      profile: 'mixed',
      hasLocation: true,
      hasPlanting: true,
      hasSprayer: true,
      hasCalibratedSprayer: true,
      hasPinnedCards: true
    });
    const done = Object.fromEntries(items.map((i) => [i.id, i.done]));
    expect(done).toEqual({
      location: true,
      area: false,
      crop: true,
      bed: false,
      equipment: false,
      calibrate: true,
      helper: false,
      assistant: false,
      cards: true
    });
  });

  it('never counts cards as saved while the device has not said so', () => {
    const cards = gettingStartedItems(BLANK).find((i) => i.id === 'cards');
    expect(cards?.done).toBe(false);
  });
});

describe('gettingStartedMode', () => {
  const s = (done: number, total: number, requiredDone: number, requiredTotal: number) => ({
    done,
    total,
    requiredDone,
    requiredTotal
  });

  it('is full until the required items are done, then a strip, then gone', () => {
    expect(gettingStartedMode(s(3, 7, 3, 5), false)).toBe('full');
    expect(gettingStartedMode(s(5, 7, 5, 5), false)).toBe('strip');
    expect(gettingStartedMode(s(7, 7, 5, 5), false)).toBe('hidden');
  });

  it('is gone once dismissed', () => {
    expect(gettingStartedMode(s(0, 7, 0, 5), true)).toBe('hidden');
  });

  const arbFacts = fc.record({
    profile: fc.constantFrom('garden', 'farm', 'mixed', null),
    hasLocation: fc.boolean(),
    hasMappedArea: fc.boolean(),
    hasPlanting: fc.boolean(),
    hasGardenBed: fc.boolean(),
    hasEquipment: fc.boolean(),
    hasSprayer: fc.boolean(),
    hasCalibratedSprayer: fc.boolean(),
    hasHelper: fc.boolean(),
    hasAiKey: fc.boolean(),
    hasPinnedCards: fc.constantFrom(true, false, null)
  }) as fc.Arbitrary<GettingStartedFacts>;

  it('summary counts are consistent for any facts', () => {
    fc.assert(
      fc.property(arbFacts, fc.boolean(), (facts, dismissed) => {
        const items = gettingStartedItems(facts);
        const sum = summarizeGettingStarted(items);
        expect(sum.requiredDone).toBeLessThanOrEqual(sum.requiredTotal);
        expect(sum.done).toBeLessThanOrEqual(sum.total);
        expect(sum.requiredTotal).toBeGreaterThanOrEqual(4);
        const mode = gettingStartedMode(sum, dismissed);
        if (mode === 'full') expect(sum.requiredDone).toBeLessThan(sum.requiredTotal);
        if (!dismissed && sum.done < sum.total) expect(mode).not.toBe('hidden');
      })
    );
  });
});

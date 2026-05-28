import { describe, it, expect } from 'vitest';
import { evaluateHarvestMoisture, thresholdForPlugin } from './harvestMoisture';

describe('harvestMoisture — UC-16 storage-moisture safety gate', () => {
  describe('thresholdForPlugin', () => {
    it('returns 13.5% for small-grain.zadoks (wheat, oats, barley)', () => {
      expect(thresholdForPlugin({ archetype: 'small-grain.zadoks' })).toBe(13.5);
    });
    it('returns 15.0% for dry-seed-legume', () => {
      expect(thresholdForPlugin({ archetype: 'dry-seed-legume' })).toBe(15.0);
    });
    it('returns 18.0% for forage-cutting-cycle (hay)', () => {
      expect(thresholdForPlugin({ archetype: 'forage-cutting-cycle' })).toBe(18.0);
    });
    it('returns 70.0% for winter-squash-cure (catches outright spoilage)', () => {
      expect(thresholdForPlugin({ archetype: 'winter-squash-cure' })).toBe(70.0);
    });
    it('returns null for archetypes with no kernel gate (e.g. continuous-harvest-fruit)', () => {
      expect(thresholdForPlugin({ archetype: 'continuous-harvest-fruit' })).toBeNull();
    });
    it('falls back through cropFamily when archetype is absent', () => {
      // Per resolveArchetype: cropFamily='cereal-grain' → small-grain.zadoks
      expect(thresholdForPlugin({ cropFamily: 'cereal-grain' })).toBe(13.5);
    });
  });

  describe('evaluateHarvestMoisture', () => {
    const wheat = { archetype: 'small-grain.zadoks' as const };

    it('returns null when no gate exists (archetype outside the map)', () => {
      const r = evaluateHarvestMoisture({
        moisturePct: 22,
        cropPlugin: { archetype: 'cut-and-come-again-leafy' }
      });
      expect(r).toBeNull();
    });

    it('returns null on a negative or non-finite moisture (no-gate on typos)', () => {
      expect(evaluateHarvestMoisture({ moisturePct: -1, cropPlugin: wheat })).toBeNull();
      expect(evaluateHarvestMoisture({ moisturePct: NaN, cropPlugin: wheat })).toBeNull();
    });

    it('returns safe well below threshold', () => {
      const r = evaluateHarvestMoisture({ moisturePct: 12.0, cropPlugin: wheat });
      expect(r?.decision).toBe('safe');
      expect(r?.thresholdPct).toBe(13.5);
      expect(r?.reason).toMatch(/12\.0.*safely.*13\.5/);
    });

    it('returns warn within 1.0% of threshold', () => {
      const r = evaluateHarvestMoisture({ moisturePct: 13.0, cropPlugin: wheat });
      expect(r?.decision).toBe('warn');
      expect(r?.reason).toMatch(/13\.0.*within.*1\.0.*13\.5/);
    });

    it('returns block strictly over threshold', () => {
      const r = evaluateHarvestMoisture({ moisturePct: 14.0, cropPlugin: wheat });
      expect(r?.decision).toBe('block');
      expect(r?.reason).toMatch(/14\.0.*13\.5.*Drying required/);
    });

    it('is exclusive at the threshold (== threshold is warn, not block)', () => {
      const r = evaluateHarvestMoisture({ moisturePct: 13.5, cropPlugin: wheat });
      expect(r?.decision).toBe('warn');
    });

    it('forage hay (18.0% threshold) blocks at 19% as expected', () => {
      const r = evaluateHarvestMoisture({
        moisturePct: 19,
        cropPlugin: { archetype: 'forage-cutting-cycle' }
      });
      expect(r?.decision).toBe('block');
      expect(r?.thresholdPct).toBe(18.0);
    });
  });
});

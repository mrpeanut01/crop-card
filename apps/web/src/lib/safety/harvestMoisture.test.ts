import fc from 'fast-check';
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
    it('returns null for winter-squash-cure (flesh is 80-90% water; no storage ceiling)', () => {
      expect(thresholdForPlugin({ archetype: 'winter-squash-cure' })).toBeNull();
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

  describe('cure-then-store crops are never gated', () => {
    const cureCrops = [
      { archetype: 'winter-squash-cure' as const },
      { archetype: 'winter-squash-cure' as const, cropFamily: 'solanaceae' },
      { cropFamily: 'root' },
      { cropFamily: 'allium' },
      { cropFamily: 'mystery' }
    ];

    it('realistic flesh moisture (squash ~88%, potato ~80%, carrot ~88%) returns null', () => {
      for (const cropPlugin of cureCrops) {
        for (const moisturePct of [65, 70, 78, 80, 88, 92]) {
          expect(evaluateHarvestMoisture({ moisturePct, cropPlugin })).toBeNull();
        }
      }
    });

    it('property: no moisture reading ever warns or blocks a cure-archetype crop', () => {
      fc.assert(
        fc.property(
          fc.constantFrom(...cureCrops),
          fc.double({ min: -10, max: 150, noNaN: false }),
          (cropPlugin, moisturePct) => evaluateHarvestMoisture({ moisturePct, cropPlugin }) === null
        )
      );
    });

    it('property: gated archetypes still block every reading above threshold', () => {
      const gated = [
        ['small-grain.zadoks', 13.5],
        ['row-grain.pollination', 15.0],
        ['dry-seed-legume', 15.0],
        ['forage-cutting-cycle', 18.0]
      ] as const;
      fc.assert(
        fc.property(
          fc.constantFrom(...gated),
          fc.double({ min: 0.001, max: 100, noNaN: true }),
          ([archetype, max], over) => {
            const r = evaluateHarvestMoisture({
              moisturePct: max + over,
              cropPlugin: { archetype }
            });
            return r?.decision === 'block' && /drying required/i.test(r.reason);
          }
        )
      );
    });

    it('small-grain warn copy keeps the "heating" watch', () => {
      const r = evaluateHarvestMoisture({
        moisturePct: 13.0,
        cropPlugin: { archetype: 'small-grain.zadoks' as const }
      });
      expect(r?.decision).toBe('warn');
      expect(r?.reason).toMatch(/heating/i);
    });
  });
});

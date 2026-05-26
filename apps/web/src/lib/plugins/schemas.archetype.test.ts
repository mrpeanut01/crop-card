/**
 * Sprint 6 / Phase 27A (#257) — archetype enum + resolveArchetype.
 *
 * Locks the contract that:
 *   - `ARCHETYPES` is exactly the 10 canonical values per CLAUDE.md
 *     Invariant 8 — adding/removing values is a kernel-level decision
 *     that needs an explicit test update.
 *   - `resolveArchetype()` honours the (override → declared → mapped →
 *     family-fallback) precedence so HarvestRouter dispatch stays in
 *     lock-step with the backfill script.
 *   - Every legacy `HarvestStyle` either maps to a canonical archetype
 *     1:1 (10 of 11) or returns null so the family fallback runs
 *     (`single-event`).
 */

import { describe, expect, it } from 'vitest';
import {
  ARCHETYPES,
  HARVEST_STYLE_TO_ARCHETYPE,
  HARVEST_STYLES,
  archetypeForFamilyFallback,
  archetypeSchema,
  resolveArchetype,
  type Archetype
} from './schemas';

describe('Phase 27A — ARCHETYPES enum (Invariant 8)', () => {
  it('declares exactly the 10 canonical values', () => {
    expect(ARCHETYPES).toEqual([
      'small-grain.zadoks',
      'row-grain.pollination',
      'dry-seed-legume',
      'winter-squash-cure',
      'continuous-harvest-fruit',
      'cut-and-come-again-leafy',
      'cover-crop.termination',
      'forage-cutting-cycle',
      'perennial-vine-quality',
      'tree-fruit-multi-pick'
    ]);
    expect(ARCHETYPES.length).toBe(10);
  });

  it('rejects unknown archetype values', () => {
    expect(archetypeSchema.safeParse('hyphenated-mystery').success).toBe(false);
    expect(archetypeSchema.safeParse('single-event').success).toBe(false);
  });

  it('accepts every declared canonical value', () => {
    for (const a of ARCHETYPES) {
      expect(archetypeSchema.safeParse(a).success).toBe(true);
    }
  });
});

describe('Phase 27A — HARVEST_STYLE_TO_ARCHETYPE map', () => {
  it('covers every legacy HARVEST_STYLES key', () => {
    for (const style of HARVEST_STYLES) {
      expect(HARVEST_STYLE_TO_ARCHETYPE).toHaveProperty(style);
    }
  });

  it('maps every legacy harvest style except single-event to a canonical archetype', () => {
    for (const style of HARVEST_STYLES) {
      const mapped = HARVEST_STYLE_TO_ARCHETYPE[style];
      if (style === 'single-event') {
        expect(mapped).toBeNull();
      } else {
        expect(mapped).not.toBeNull();
        expect(ARCHETYPES).toContain(mapped as Archetype);
      }
    }
  });
});

describe('Phase 27A — archetypeForFamilyFallback', () => {
  it('returns a canonical archetype for every known cropFamily', () => {
    const families = [
      'corn',
      'cucurbit',
      'legume',
      'broadleaf-companion',
      'orchard',
      'cover-grass',
      'cover-legume',
      'solanaceae',
      'brassica',
      'allium',
      'leafy-green',
      'root',
      'apiaceae',
      'small-fruit',
      'bramble',
      'vine-fruit',
      'stone-fruit',
      'cereal-grain',
      'forage',
      'herb-culinary'
    ];
    for (const family of families) {
      const a = archetypeForFamilyFallback(family);
      expect(ARCHETYPES).toContain(a);
    }
  });

  it('falls back to winter-squash-cure for unknown families (conservative storage default)', () => {
    expect(archetypeForFamilyFallback('mystery')).toBe('winter-squash-cure');
    expect(archetypeForFamilyFallback('')).toBe('winter-squash-cure');
  });
});

describe('Phase 27A — resolveArchetype precedence', () => {
  it('honors explicit archetype above everything else', () => {
    expect(
      resolveArchetype({
        archetype: 'continuous-harvest-fruit',
        harvestStyle: 'cure-then-store',
        cropFamily: 'cucurbit'
      })
    ).toBe('continuous-harvest-fruit');
  });

  it('falls back to harvestStyle 1:1 mapping when archetype is absent', () => {
    expect(resolveArchetype({ harvestStyle: 'tree-fruit-multi-pick' })).toBe(
      'tree-fruit-multi-pick'
    );
    expect(resolveArchetype({ harvestStyle: 'cure-then-store' })).toBe('winter-squash-cure');
  });

  it('falls back to family table when harvestStyle === single-event', () => {
    expect(resolveArchetype({ harvestStyle: 'single-event', cropFamily: 'allium' })).toBe(
      'winter-squash-cure'
    );
    expect(resolveArchetype({ harvestStyle: 'single-event', cropFamily: 'leafy-green' })).toBe(
      'cut-and-come-again-leafy'
    );
  });

  it('falls back to family table when harvestStyle is undefined', () => {
    expect(resolveArchetype({ cropFamily: 'forage' })).toBe('forage-cutting-cycle');
    expect(resolveArchetype({ cropFamily: 'solanaceae' })).toBe('continuous-harvest-fruit');
  });

  it('returns conservative default when everything is undefined', () => {
    expect(resolveArchetype({})).toBe('winter-squash-cure');
  });
});

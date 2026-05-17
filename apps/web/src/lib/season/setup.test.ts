/**
 * Tests for the per-Owner per-year season setup repo (Phase 21 / UC-42).
 *
 * Covers: round-trip persistence, partial-save merging, conditional
 * `transitioningStartedYear` field, year-keyed isolation, carry-forward,
 * helper predicates, and cross-tenant isolation (parallel to the property
 * test at `apps/web/src/lib/db/tenant.crossTenant.test.ts`).
 */

import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';

import { db } from '$lib/db/client';
import { appSettings, owners } from '$lib/db/schema';
import { runWithTenant } from '$lib/db/tenant';

import {
  allowsSynthetics,
  isOrganicCompliant,
  summarizeSeasonSetup,
  SEASON_SETUP_DEFAULTS,
  type SeasonSetup
} from './setup';
import { carryForward, loadSeasonSetup, saveSeasonSetup } from './setup.server';

const OWNER_A = 'season-setup-test-owner-a';
const OWNER_B = 'season-setup-test-owner-b';

function seedOwner(ownerId: string): void {
  db.insert(owners)
    .values({
      id: ownerId,
      name: ownerId,
      slug: ownerId.replace(/[^a-z0-9-]/g, '-'),
      billingStatus: 'active'
    })
    .onConflictDoNothing()
    .run();
}

function clearSettingsFor(ownerId: string): void {
  db.delete(appSettings).where(eq(appSettings.ownerId, ownerId)).run();
}

describe('season setup repo', () => {
  beforeEach(() => {
    seedOwner(OWNER_A);
    seedOwner(OWNER_B);
    clearSettingsFor(OWNER_A);
    clearSettingsFor(OWNER_B);
  });

  it('returns null when no setup exists for the year', () => {
    runWithTenant(OWNER_A, () => {
      expect(loadSeasonSetup(2030)).toBeNull();
    });
  });

  it('round-trips a full save', () => {
    runWithTenant(OWNER_A, () => {
      const saved = saveSeasonSetup(2026, {
        philosophy: 'certified-organic',
        weedStrategy: 'cultivate-first',
        pestStrategy: 'ipm',
        fertilityApproach: 'compost-amendments',
        coverCropIntent: 'vetch-clover',
        sprayCapacity: 'backpack-4gal'
      });

      const loaded = loadSeasonSetup(2026);
      expect(loaded).not.toBeNull();
      expect(loaded?.philosophy).toBe('certified-organic');
      expect(loaded?.weedStrategy).toBe('cultivate-first');
      expect(loaded?.pestStrategy).toBe('ipm');
      expect(loaded?.fertilityApproach).toBe('compost-amendments');
      expect(loaded?.coverCropIntent).toBe('vetch-clover');
      expect(loaded?.sprayCapacity).toBe('backpack-4gal');
      expect(loaded?.transitioningStartedYear).toBeNull();
      expect(loaded?.year).toBe(2026);
      expect(loaded?.setAt).toBe(saved.setAt);
    });
  });

  it('applies defaults to missing fields on a partial first save', () => {
    runWithTenant(OWNER_A, () => {
      saveSeasonSetup(2026, { philosophy: 'non-gmo' });
      const loaded = loadSeasonSetup(2026);
      expect(loaded?.philosophy).toBe('non-gmo');
      expect(loaded?.weedStrategy).toBe(SEASON_SETUP_DEFAULTS.weedStrategy);
      expect(loaded?.pestStrategy).toBe(SEASON_SETUP_DEFAULTS.pestStrategy);
      expect(loaded?.fertilityApproach).toBe(SEASON_SETUP_DEFAULTS.fertilityApproach);
      expect(loaded?.coverCropIntent).toBe(SEASON_SETUP_DEFAULTS.coverCropIntent);
      expect(loaded?.sprayCapacity).toBe(SEASON_SETUP_DEFAULTS.sprayCapacity);
    });
  });

  it('preserves existing fields on a subsequent partial save', () => {
    runWithTenant(OWNER_A, () => {
      saveSeasonSetup(2026, {
        philosophy: 'certified-organic',
        coverCropIntent: 'fall-cereal'
      });
      // Edit only philosophy.
      saveSeasonSetup(2026, { philosophy: 'organic-transitioning', transitioningStartedYear: 2025 });

      const loaded = loadSeasonSetup(2026);
      expect(loaded?.philosophy).toBe('organic-transitioning');
      expect(loaded?.coverCropIntent).toBe('fall-cereal'); // unchanged
      expect(loaded?.transitioningStartedYear).toBe(2025);
    });
  });

  it('clears transitioningStartedYear when philosophy moves away from organic-transitioning', () => {
    runWithTenant(OWNER_A, () => {
      saveSeasonSetup(2026, {
        philosophy: 'organic-transitioning',
        transitioningStartedYear: 2024
      });
      expect(loadSeasonSetup(2026)?.transitioningStartedYear).toBe(2024);

      saveSeasonSetup(2026, { philosophy: 'certified-organic' });
      expect(loadSeasonSetup(2026)?.transitioningStartedYear).toBeNull();
    });
  });

  it('keeps separate setups per year', () => {
    runWithTenant(OWNER_A, () => {
      saveSeasonSetup(2026, { philosophy: 'conventional' });
      saveSeasonSetup(2027, { philosophy: 'certified-organic' });

      expect(loadSeasonSetup(2026)?.philosophy).toBe('conventional');
      expect(loadSeasonSetup(2027)?.philosophy).toBe('certified-organic');
    });
  });

  describe('carryForward', () => {
    it('returns null when the source year has no setup', () => {
      runWithTenant(OWNER_A, () => {
        expect(carryForward(2030, 2031)).toBeNull();
      });
    });

    it('copies all fields from source to target year', () => {
      runWithTenant(OWNER_A, () => {
        saveSeasonSetup(2026, {
          philosophy: 'certified-organic',
          weedStrategy: 'cultivate-first',
          pestStrategy: 'ipm',
          fertilityApproach: 'compost-amendments',
          coverCropIntent: 'vetch-clover',
          sprayCapacity: 'backpack-4gal'
        });

        const carried = carryForward(2026, 2027);
        expect(carried).not.toBeNull();
        expect(carried?.year).toBe(2027);
        expect(carried?.philosophy).toBe('certified-organic');
        expect(carried?.coverCropIntent).toBe('vetch-clover');

        // Source year unchanged.
        expect(loadSeasonSetup(2026)?.year).toBe(2026);
      });
    });

    it('does not overwrite an existing target-year setup', () => {
      runWithTenant(OWNER_A, () => {
        saveSeasonSetup(2026, { philosophy: 'conventional' });
        saveSeasonSetup(2027, { philosophy: 'certified-organic' });

        const result = carryForward(2026, 2027);
        // Returns the existing 2027 setup, not the conventional 2026.
        expect(result?.philosophy).toBe('certified-organic');
      });
    });
  });

  describe('helper predicates', () => {
    function fixture(philosophy: SeasonSetup['philosophy']): SeasonSetup {
      return {
        ...SEASON_SETUP_DEFAULTS,
        philosophy,
        year: 2026,
        setAt: 0
      };
    }

    it('isOrganicCompliant covers transitioning + certified', () => {
      expect(isOrganicCompliant(fixture('certified-organic'))).toBe(true);
      expect(isOrganicCompliant(fixture('organic-transitioning'))).toBe(true);
      expect(isOrganicCompliant(fixture('non-gmo'))).toBe(false);
      expect(isOrganicCompliant(fixture('conventional'))).toBe(false);
    });

    it('allowsSynthetics is true only for conventional + non-gmo', () => {
      expect(allowsSynthetics(fixture('conventional'))).toBe(true);
      expect(allowsSynthetics(fixture('non-gmo'))).toBe(true);
      expect(allowsSynthetics(fixture('certified-organic'))).toBe(false);
      expect(allowsSynthetics(fixture('organic-transitioning'))).toBe(false);
    });
  });

  describe('summarizeSeasonSetup', () => {
    it('produces a compact human-readable string', () => {
      const s: SeasonSetup = {
        ...SEASON_SETUP_DEFAULTS,
        philosophy: 'certified-organic',
        pestStrategy: 'ipm',
        fertilityApproach: 'compost-amendments',
        sprayCapacity: 'backpack-4gal',
        coverCropIntent: 'vetch-clover',
        year: 2026,
        setAt: 0
      };
      const summary = summarizeSeasonSetup(s);
      expect(summary).toContain('Certified organic');
      expect(summary).toContain('IPM');
      expect(summary).toContain('Compost');
      expect(summary).toContain('Backpack');
      expect(summary).toContain('Vetch');
      expect(summary).toContain('2026');
    });

    it('omits the Cover segment when coverCropIntent is none', () => {
      const s: SeasonSetup = {
        ...SEASON_SETUP_DEFAULTS,
        year: 2026,
        setAt: 0
      };
      expect(summarizeSeasonSetup(s)).not.toContain('Cover:');
    });
  });

  describe('cross-tenant isolation', () => {
    it("Owner A's setup is invisible to Owner B", () => {
      runWithTenant(OWNER_A, () => {
        saveSeasonSetup(2026, { philosophy: 'certified-organic' });
      });
      runWithTenant(OWNER_B, () => {
        expect(loadSeasonSetup(2026)).toBeNull();
      });
    });

    it('Owners can hold different setups for the same year', () => {
      runWithTenant(OWNER_A, () => {
        saveSeasonSetup(2026, { philosophy: 'certified-organic' });
      });
      runWithTenant(OWNER_B, () => {
        saveSeasonSetup(2026, { philosophy: 'conventional' });
      });

      runWithTenant(OWNER_A, () => {
        expect(loadSeasonSetup(2026)?.philosophy).toBe('certified-organic');
      });
      runWithTenant(OWNER_B, () => {
        expect(loadSeasonSetup(2026)?.philosophy).toBe('conventional');
      });
    });
  });
});

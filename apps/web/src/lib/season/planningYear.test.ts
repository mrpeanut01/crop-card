import { beforeEach, describe, expect, it } from 'vitest';

import { db } from '$lib/db/client';
import { appSettings, owners } from '$lib/db/schema';
import { runWithTenant, tenantWhere } from '$lib/db/tenant';

import {
  isSelectablePlanningYear,
  pastPlanningYears,
  resolvePlanningYear,
  selectablePlanningYears,
  suggestPlanningYear
} from './planningYear';
import {
  getActivePlanningYear,
  loadPlanningYearView,
  setActivePlanningYear
} from './planningYear.server';
import { saveSeasonSetup } from './setup.server';

const SEPT_2026 = new Date(2026, 8, 25);
const MARCH_2026 = new Date(2026, 2, 10);

describe('planning year rules', () => {
  it('suggests next year once the planting window has closed', () => {
    expect(suggestPlanningYear(SEPT_2026)).toBe(2027);
    expect(suggestPlanningYear(new Date(2026, 6, 1))).toBe(2027);
    expect(suggestPlanningYear(new Date(2026, 5, 30))).toBe(2026);
    expect(suggestPlanningYear(MARCH_2026)).toBe(2026);
  });

  it('allows this calendar year or one year ahead, never further', () => {
    expect(selectablePlanningYears(SEPT_2026)).toEqual([2026, 2027]);
    expect(isSelectablePlanningYear(2027, MARCH_2026)).toBe(true);
    expect(isSelectablePlanningYear(2028, SEPT_2026)).toBe(false);
    expect(isSelectablePlanningYear(2025, SEPT_2026)).toBe(false);
  });

  it('falls back to the suggestion when the stored year has gone stale', () => {
    expect(resolvePlanningYear(null, SEPT_2026)).toBe(2027);
    expect(resolvePlanningYear(2026, SEPT_2026)).toBe(2026);
    expect(resolvePlanningYear(2026, new Date(2028, 1, 1))).toBe(2028);
  });

  it('lists only earlier years as past, newest first, deduplicated', () => {
    expect(pastPlanningYears([2024, 2026, 2025, 2024, 2027], SEPT_2026)).toEqual([2025, 2024]);
  });
});

const OWNER_A = 'planning-year-test-owner-a';
const OWNER_B = 'planning-year-test-owner-b';

function seedOwner(id: string): void {
  db.insert(owners)
    .values({ id, name: id, slug: id, billingStatus: 'active' })
    .onConflictDoNothing()
    .run();
  runWithTenant(id, () => db.delete(appSettings).where(tenantWhere(appSettings)).run());
}

describe('planning year repo', () => {
  beforeEach(() => {
    seedOwner(OWNER_A);
    seedOwner(OWNER_B);
  });

  it('defaults to the suggestion and persists an override per Owner', () => {
    runWithTenant(OWNER_A, () => {
      expect(getActivePlanningYear(SEPT_2026)).toBe(2027);
      setActivePlanningYear(2026, SEPT_2026);
      expect(getActivePlanningYear(SEPT_2026)).toBe(2026);
      expect(loadPlanningYearView(SEPT_2026).chosen).toBe(true);
    });
    runWithTenant(OWNER_B, () => {
      expect(getActivePlanningYear(SEPT_2026)).toBe(2027);
      expect(loadPlanningYearView(SEPT_2026).chosen).toBe(false);
    });
  });

  it('refuses years outside the selectable window', () => {
    runWithTenant(OWNER_A, () => {
      expect(() => setActivePlanningYear(2028, SEPT_2026)).toThrow();
      expect(() => setActivePlanningYear(2025, SEPT_2026)).toThrow();
    });
  });

  it('surfaces past seasons that have a saved setup, scoped to the Owner', () => {
    runWithTenant(OWNER_A, () => {
      saveSeasonSetup(2024, { philosophy: 'certified-organic' });
      saveSeasonSetup(2027, { philosophy: 'conventional' });
      expect(loadPlanningYearView(SEPT_2026).pastYears).toContain(2024);
      expect(loadPlanningYearView(SEPT_2026).pastYears).not.toContain(2027);
    });
    runWithTenant(OWNER_B, () => {
      expect(loadPlanningYearView(SEPT_2026).pastYears).not.toContain(2024);
    });
  });
});

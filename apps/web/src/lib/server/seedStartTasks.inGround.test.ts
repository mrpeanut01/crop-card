// @vitest-environment node
/**
 * #645: a planting already in the ground (an orchard set out years ago, a
 * backdated record) gets no Sow indoors, Harden off or Transplant tasks,
 * and a re-date into the past aborts the open ones.
 */
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { db } from '$lib/db/client';
import { owners } from '$lib/db/schema';
import { runWithTenant } from '$lib/db/tenant';
import { createField } from '$lib/db/fields';
import { createBlock } from '$lib/db/blocks';
import { createPlanned, setSchedule } from '$lib/db/crops';
import {
  applyPlantingEstablishment,
  isAlreadyInGround,
  listSeedStartTasks,
  localizeSeedStartNotes
} from './seedStartTasks';

const DAY = 86_400_000;
const NOW = Date.parse('2026-10-07T15:00:00Z');
const PLUGIN = {
  plantingGuide: {
    startIndoorsWeeks: { min: 6, max: 8 },
    hardenOffDays: { min: 7, max: 10 },
    establishment: 'transplant' as const
  }
};

function farm(): string {
  const ownerId = `ssig-${randomUUID().slice(0, 8)}`;
  db.insert(owners)
    .values({ id: ownerId, name: ownerId, slug: ownerId, billingStatus: 'active' })
    .run();
  return ownerId;
}

function planting(plantingDate: number) {
  const area = createField({ name: 'Orchard', kind: 'orchard' });
  const block = createBlock({ name: 'Apples', fieldId: area.id, acres: 1 });
  return createPlanned({
    blockId: block.id,
    cropPluginId: 'apple-honeycrisp',
    varietyDisplayName: 'Apple Honeycrisp',
    plantingDate
  });
}

const openTasks = (cropId: string) =>
  listSeedStartTasks(cropId).filter((t) => !t.completedAt && !t.abortedAt);

describe('isAlreadyInGround', () => {
  it('counts a date a full day or more behind now as planted', () => {
    expect(isAlreadyInGround(NOW - DAY, NOW)).toBe(true);
    expect(isAlreadyInGround(NOW - 5 * 365 * DAY, NOW)).toBe(true);
    expect(isAlreadyInGround(NOW - DAY + 1, NOW)).toBe(false);
    expect(isAlreadyInGround(NOW + 30 * DAY, NOW)).toBe(false);
  });
});

describe('applyPlantingEstablishment (#645)', () => {
  it('makes no seed-start tasks for a seedling planted years ago', () => {
    runWithTenant(farm(), () => {
      const crop = planting(Date.parse('2019-04-10T12:00:00Z'));
      const out = applyPlantingEstablishment(
        crop.id,
        { establishment: 'transplant', startIndoors: true },
        PLUGIN,
        NOW
      );
      expect(out.establishment).toBe('transplant');
      expect(out.startedIndoors).toBe(false);
      expect(out.taskIds).toEqual([]);
      expect(out.notes).toEqual(['Already in the ground, so no seed-start tasks were made.']);
      expect(localizeSeedStartNotes(out.notes, 'es')[0]).toMatch(/Ya está en la tierra/);
      expect(listSeedStartTasks(crop.id)).toEqual([]);
    });
  });

  it('still makes them for a seedling going in later', () => {
    runWithTenant(farm(), () => {
      const crop = planting(NOW + 60 * DAY);
      const out = applyPlantingEstablishment(
        crop.id,
        { establishment: 'transplant', startIndoors: true },
        PLUGIN,
        NOW
      );
      expect(out.startedIndoors).toBe(true);
      expect(out.taskIds).toHaveLength(3);
      expect(openTasks(crop.id)).toHaveLength(3);
    });
  });

  it('aborts open seed-start tasks once the planting is re-dated into the past', () => {
    runWithTenant(farm(), () => {
      const crop = planting(NOW + 60 * DAY);
      applyPlantingEstablishment(
        crop.id,
        { establishment: 'transplant', startIndoors: true },
        PLUGIN,
        NOW
      );
      expect(openTasks(crop.id)).toHaveLength(3);
      setSchedule(crop.id, { plantingDate: Date.parse('2020-05-01T12:00:00Z') });
      applyPlantingEstablishment(crop.id, { startIndoors: true }, PLUGIN, NOW);
      expect(openTasks(crop.id)).toHaveLength(0);
    });
  });
});

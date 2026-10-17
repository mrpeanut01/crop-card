// @vitest-environment node
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { db } from '$lib/db/client';
import { owners } from '$lib/db/schema';
import { runWithTenant } from '$lib/db/tenant';
import { createField } from '$lib/db/fields';
import { createBlock } from '$lib/db/blocks';
import { createEquipment } from '$lib/db/equipment';
import {
  insertIrrigationSkip,
  listIrrigationSkips,
  listWaterTargets,
  loadWatererRowsForAreas,
  normalizeTargets,
  replaceWaterTargets
} from '$lib/db/waterers';
import { watererSnapshotPart } from './watererSnapshot';

const SCHEDULE = {
  days: [1, 3, 5],
  start: '06:00',
  minutes: 20,
  method: 'drip',
  inchesPerRun: 0.4,
  gallonsPerMinute: null,
  activeFrom: 0
};

function seedOwner(): string {
  const id = `waterer-snap-${randomUUID()}`;
  db.insert(owners).values({ id, name: id, slug: id, billingStatus: 'active' }).run();
  return id;
}

function seedTimer(ownerId: string) {
  return runWithTenant(ownerId, () => {
    const field = createField({ name: 'Herb garden', kind: 'garden' });
    const bed = createBlock({ name: 'Bed 1', fieldId: field.id });
    const timer = createEquipment({
      type: 'irrigation',
      label: 'Drip timer',
      spec: { schedule: SCHEDULE }
    });
    replaceWaterTargets(timer.id, [{ fieldId: field.id, blockId: bed.id }]);
    insertIrrigationSkip({ equipmentId: timer.id, scheduledAt: 1_000, reason: 'other' });
    return { fieldId: field.id, bedId: bed.id, timerId: timer.id };
  });
}

describe('waterer snapshot part', () => {
  it('carries each scheduled waterer with its targets', () => {
    const owner = seedOwner();
    const s = seedTimer(owner);
    expect(runWithTenant(owner, () => watererSnapshotPart())).toEqual({
      waterers: [
        {
          equipmentId: s.timerId,
          label: 'Drip timer',
          schedule: {
            days: [1, 3, 5],
            start: '06:00',
            minutes: 20,
            method: 'drip',
            inchesPerRun: 0.4
          },
          targets: [{ fieldId: s.fieldId, blockId: s.bedId }]
        }
      ]
    });
  });

  it('adds nothing for a farm with no waterer or a waterer with no schedule', () => {
    const owner = seedOwner();
    expect(runWithTenant(owner, () => watererSnapshotPart())).toEqual({});
    runWithTenant(owner, () => {
      const field = createField({ name: 'Beds', kind: 'garden' });
      const timer = createEquipment({ type: 'irrigation', label: 'Unset timer' });
      replaceWaterTargets(timer.id, [{ fieldId: field.id, blockId: null }]);
    });
    expect(runWithTenant(owner, () => watererSnapshotPart())).toEqual({});
  });
});

describe('waterer repo tenant isolation', () => {
  it('never reads another farm targets or skips', () => {
    const a = seedOwner();
    const b = seedOwner();
    const sa = seedTimer(a);
    seedTimer(b);
    runWithTenant(b, () => {
      expect(listWaterTargets([sa.timerId])).toEqual([]);
      expect(listIrrigationSkips({ equipmentIds: [sa.timerId] })).toEqual([]);
      const rows = loadWatererRowsForAreas([sa.fieldId], 0, 10_000);
      expect(rows.targets).toEqual([]);
      expect(rows.skips.size).toBe(0);
      expect(watererSnapshotPart().waterers?.map((w) => w.equipmentId)).not.toContain(sa.timerId);
    });
    runWithTenant(a, () => {
      const rows = loadWatererRowsForAreas([sa.fieldId], 0, 10_000);
      expect(rows.targets).toHaveLength(1);
      expect(rows.skips.get(sa.timerId)).toEqual([1_000]);
    });
  });
});

describe('normalizeTargets', () => {
  it('keeps one row per target and drops beds of an Area covered whole', () => {
    expect(
      normalizeTargets([
        { fieldId: 'f1', blockId: 'b1' },
        { fieldId: 'f1', blockId: null },
        { fieldId: 'f2', blockId: 'b2' },
        { fieldId: 'f2', blockId: 'b2' }
      ])
    ).toEqual([
      { fieldId: 'f1', blockId: null },
      { fieldId: 'f2', blockId: 'b2' }
    ]);
  });
});

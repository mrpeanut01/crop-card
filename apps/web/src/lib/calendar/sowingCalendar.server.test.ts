// @vitest-environment node
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { db } from '$lib/db/client';
import { crops, owners } from '$lib/db/schema';
import { runWithTenant, withTenant } from '$lib/db/tenant';
import { createField } from '$lib/db/fields';
import { createBlock } from '$lib/db/blocks';
import { createPlanned } from '$lib/db/crops';
import { createTask } from '$lib/db/tasks';
import { listSeedStartFacts, parseSeedStartKey } from '$lib/db/sowingCalendar';
import type { PluginRegistry } from '$lib/plugins';
import type { CropPlugin } from '$lib/plugins/schemas';
import { insertBlockProtection } from '$lib/db/blockProtections';
import { loadEffectiveFrostByBlock } from '$lib/server/blockFrost.server';
import { loadSowingCalendar } from './sowingCalendar.server';

const DAY = 86_400_000;

const tomato: CropPlugin = {
  pluginId: 'tomato-sowcal',
  type: 'crop',
  displayName: 'Tomato',
  version: '1.0.0',
  cropFamily: 'solanaceae',
  harvestStyle: 'continuous-fruit',
  bloomWindow: { continuous: true, beeAttractive: true },
  daysToMaturity: { min: 70, max: 80 }
};

const registry = {
  get: (id: string) => (id === tomato.pluginId ? { plugin: tomato } : undefined)
} as unknown as PluginRegistry;

function newOwner(): string {
  const id = `sowcal-${randomUUID()}`;
  db.insert(owners).values({ id, name: id, slug: id, billingStatus: 'active' }).run();
  return id;
}

function seed(ownerId: string, plantingMs: number | null) {
  return runWithTenant(ownerId, () => {
    const field = createField({ name: 'Garden', kind: 'garden' });
    const block = createBlock({ name: 'Bed 1', fieldId: field.id });
    const crop = createPlanned({
      blockId: block.id,
      cropPluginId: tomato.pluginId,
      varietyDisplayName: 'Tomato',
      plantingDate: plantingMs
    });
    return { block, crop };
  });
}

describe('parseSeedStartKey', () => {
  it('parses seedstart keys and refuses others', () => {
    expect(parseSeedStartKey('seedstart:abc-1:sow')).toEqual({ cropId: 'abc-1', step: 'sow' });
    expect(parseSeedStartKey('seedstart:abc:bogus')).toBeNull();
    expect(parseSeedStartKey('spray:abc:sow')).toBeNull();
    expect(parseSeedStartKey(null)).toBeNull();
  });
});

describe('listSeedStartFacts', () => {
  it('reads establishment, tray date and seedstart tasks, scoped to the tenant', () => {
    const a = newOwner();
    const b = newOwner();
    const t = new Date(2026, 4, 10).getTime();
    const { crop } = seed(a, t);
    runWithTenant(a, () => {
      db.update(crops)
        .set({ establishment: 'transplant' })
        .where(withTenant(crops, eq(crops.id, crop.id)))
        .run();
      const task = createTask({
        title: 'Sow indoors',
        kind: 'primary',
        cropId: crop.id,
        scheduledFor: t - 42 * DAY
      });
      db.run(
        `UPDATE tasks SET plugin_template_key = 'seedstart:${crop.id}:sow' WHERE id = '${task.id}'`
      );
    });
    const mine = runWithTenant(a, () => listSeedStartFacts([crop.id]));
    expect(mine.get(crop.id)).toMatchObject({
      establishment: 'transplant',
      sownIndoorsAt: null,
      tasks: [{ step: 'sow', scheduledFor: t - 42 * DAY }]
    });
    const theirs = runWithTenant(b, () => listSeedStartFacts([crop.id]));
    expect(theirs.size).toBe(0);
  });
});

describe('loadSowingCalendar', () => {
  it('draws an indoor bar and a transplant point from the plan the farmer made', () => {
    const a = newOwner();
    const t = new Date(2026, 4, 10).getTime();
    const { crop } = seed(a, t);
    const data = runWithTenant(a, () => {
      db.update(crops)
        .set({ establishment: 'transplant', sownIndoorsAt: new Date(t - 40 * DAY) })
        .where(withTenant(crops, eq(crops.id, crop.id)))
        .run();
      return loadSowingCalendar(registry, '2026', new Date(2026, 3, 1).getTime());
    });
    expect(data.year).toBe(2026);
    const row = data.calendar.rows.find((r) => r.plantingId === crop.id)!;
    expect(row.bars.map((b) => [b.kind, b.recorded])).toEqual([
      ['indoor-sow', true],
      ['transplant', false]
    ]);
    expect(data.calendar.frostLines.map((l) => l.kind)).toEqual(
      expect.arrayContaining(['last-spring', 'first-fall'])
    );
  });

  it('an undated plan gets a planting window, and a covered bed gets a row note', () => {
    const a = newOwner();
    const { crop, block } = seed(a, null);
    const data = runWithTenant(a, () =>
      loadSowingCalendar(registry, '2026', new Date(2026, 1, 1).getTime(), {
        frostByBlock: () => ({
          [block.id]: {
            lastSpringFrostMs: new Date(2026, 3, 2).getTime(),
            firstFallFrostMs: new Date(2026, 9, 30).getTime(),
            frostFree: false,
            springShiftDays: 18,
            fallShiftDays: 0
          }
        })
      })
    );
    const row = data.calendar.rows.find((r) => r.plantingId === crop.id)!;
    expect(row.bars.map((b) => b.kind)).toEqual(['window']);
    expect(row.note).toMatchObject({ kind: 'covered' });
  });

  it('the real per-bed frost loader turns a cover into a row note', () => {
    const a = newOwner();
    const { crop, block } = seed(a, null);
    const data = runWithTenant(a, () => {
      insertBlockProtection({
        blockId: block.id,
        kind: 'low-tunnel',
        springShiftDays: 14,
        fallShiftDays: null,
        provenance: 'manual',
        installedOn: null,
        removedOn: null,
        seasonYear: 2026,
        notes: null
      });
      return loadSowingCalendar(registry, '2026', new Date(2026, 1, 1).getTime(), {
        frostByBlock: loadEffectiveFrostByBlock
      });
    });
    const row = data.calendar.rows.find((r) => r.plantingId === crop.id)!;
    expect(row.note).toMatchObject({ kind: 'covered' });
  });

  it("never shows another farm's plantings", () => {
    const a = newOwner();
    const b = newOwner();
    const { crop } = seed(a, new Date(2026, 4, 10).getTime());
    const data = runWithTenant(b, () =>
      loadSowingCalendar(registry, '2026', new Date(2026, 3, 1).getTime())
    );
    expect(data.calendar.rows.some((r) => r.plantingId === crop.id)).toBe(false);
  });
});

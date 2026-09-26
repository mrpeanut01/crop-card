// @vitest-environment node
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { db } from '$lib/db/client';
import { owners } from '$lib/db/schema';
import { runWithTenant } from '$lib/db/tenant';
import { createField } from '$lib/db/fields';
import { createBlock } from '$lib/db/blocks';
import { createPlanned } from '$lib/db/crops';
import { loadGardenDesign } from './gardenDesignLoad';

function seedOwner(): string {
  const id = `designer-load-${randomUUID()}`;
  db.insert(owners).values({ id, name: id, slug: id, billingStatus: 'active' }).run();
  return id;
}

function seedGarden() {
  const garden = createField({ name: 'Kitchen Garden', kind: 'garden', widthFt: 20, lengthFt: 30 });
  const bed = createBlock({
    name: 'Bed 1',
    fieldId: garden.id,
    kind: 'bed',
    widthFt: 4,
    lengthFt: 8,
    xFt: 2,
    yFt: 3,
    rotationDeg: 0,
    bedStyle: 'raised'
  });
  const loose = createBlock({
    name: 'Bed 2',
    fieldId: garden.id,
    kind: 'bed',
    widthFt: 4,
    lengthFt: 8
  });
  const tomato = createPlanned({
    blockId: bed.id,
    cropPluginId: 'tomato-celebrity-f1',
    varietyDisplayName: 'Tomato Celebrity F1',
    plantingDate: Date.UTC(2026, 4, 1),
    placement: {
      footprint: { x_in: 0, y_in: 0, w_in: 48, l_in: 96 },
      spacingIn: null,
      rowSpacingIn: null,
      spacingPattern: 'square',
      plantCount: null,
      plantCountProvenance: null
    }
  });
  createPlanned({
    blockId: bed.id,
    cropPluginId: 'tomato-celebrity-f1',
    varietyDisplayName: 'Old Tomato',
    plantingDate: Date.UTC(2024, 4, 1)
  });
  return { garden, bed, loose, tomato };
}

describe('loadGardenDesign', () => {
  it('builds the owner design with beds, placed plantings, history and the crop catalog', async () => {
    await runWithTenant(seedOwner(), async () => {
      const { garden, bed, loose, tomato } = seedGarden();
      const loaded = (await loadGardenDesign(garden.id, {
        seasonYear: 2026,
        readOnlyReason: null
      }))!;
      expect(loaded.areaKind).toBe('garden');
      expect(loaded.design.canvas).toMatchObject({
        widthFt: 20,
        lengthFt: 30,
        source: 'dimensions'
      });
      expect(loaded.design.beds.map((b) => b.blockId)).toEqual([bed.id, loose.id]);
      expect(loaded.design.unplacedBedIds).toEqual([loose.id]);
      expect(loaded.design.plantings).toHaveLength(1);
      expect(loaded.design.plantings[0]).toMatchObject({
        cropId: tomato.id,
        footprint: { w_in: 48, l_in: 96 },
        plantCount: 3,
        plantCountProvenance: 'data'
      });
      expect(loaded.history[bed.id].map((h) => h.seasonYear).sort()).toEqual([2024, 2026]);
      expect(loaded.catalog.some((c) => c.pluginId === 'lettuce-buttercrunch')).toBe(true);
      expect(loaded.lookbackByFamily.solanaceae).toBeGreaterThanOrEqual(1);
      expect(loaded.design.readOnly).toBe(false);
    });
  });

  it('marks a helper view read-only', async () => {
    await runWithTenant(seedOwner(), async () => {
      const { garden } = seedGarden();
      const loaded = (await loadGardenDesign(garden.id, {
        seasonYear: 2026,
        readOnlyReason: 'role'
      }))!;
      expect(loaded.design).toMatchObject({ readOnly: true, readOnlyReason: 'role' });
    });
  });

  it('is null for a field and for another Owner garden', async () => {
    let otherGarden = '';
    await runWithTenant(seedOwner(), async () => {
      otherGarden = seedGarden().garden.id;
    });
    await runWithTenant(seedOwner(), async () => {
      const field = createField({ name: 'Back Forty', kind: 'field', widthFt: 400, lengthFt: 300 });
      expect(
        await loadGardenDesign(field.id, { seasonYear: 2026, readOnlyReason: null })
      ).toBeNull();
      expect(
        await loadGardenDesign(otherGarden, { seasonYear: 2026, readOnlyReason: null })
      ).toBeNull();
    });
  });
});

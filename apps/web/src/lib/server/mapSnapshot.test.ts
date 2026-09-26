import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { db } from '$lib/db/client';
import { owners } from '$lib/db/schema';
import { runWithTenant } from '$lib/db/tenant';
import { createArea } from '$lib/db/areas';
import { createBlock } from '$lib/db/blocks';
import { createPlanned } from '$lib/db/crops';
import { createTask } from '$lib/db/tasks';
import { setSetting } from '$lib/db/settings';
import { buildAreaCard, buildFarmMapCard } from '$lib/cards/build';
import { buildMapSnapshot } from './mapSnapshot';

const DAY = 86_400_000;

function newOwner(name: string): string {
  const id = `mapsnap-${randomUUID()}`;
  db.insert(owners).values({ id, name, slug: id, billingStatus: 'active' }).run();
  return id;
}

function seedFarm(ownerId: string, now: number) {
  return runWithTenant(ownerId, () => {
    const garden = createArea({
      name: 'Kitchen Garden',
      kind: 'garden',
      widthFt: 30,
      lengthFt: 40
    });
    const barn = createArea({ name: 'Bank Barn', kind: 'barn' });
    const bed = createBlock({ name: 'Bed 1', fieldId: garden.id, widthFt: 4, lengthFt: 8 });
    const crop = createPlanned({
      blockId: bed.id,
      cropPluginId: 'tomato',
      varietyDisplayName: 'Tomato'
    });
    createTask({
      title: 'Stake tomatoes',
      kind: 'primary',
      blockId: bed.id,
      scheduledFor: now + 2 * DAY
    });
    createTask({
      title: 'Far future',
      kind: 'primary',
      blockId: bed.id,
      scheduledFor: now + 90 * DAY
    });
    return { garden, barn, bed, crop };
  });
}

describe('buildMapSnapshot', () => {
  it('gathers the active Owner’s areas, plantings and next-month tasks', () => {
    const now = Date.now();
    const a = newOwner('Goose Creek');
    const { garden, crop } = seedFarm(a, now);
    const snap = runWithTenant(a, () => buildMapSnapshot({ now }));
    expect(snap.ownerId).toBe(a);
    expect(snap.farmName).toBe('Goose Creek');
    expect(snap.areas.map((x) => x.kind).sort()).toEqual(['barn', 'garden']);
    expect(snap.plantings.map((p) => p.id)).toEqual([crop.id]);
    expect(snap.tasks.map((t) => t.title)).toEqual(['Stake tomatoes']);
    expect(snap.frost).toMatchObject({
      lastSpring: '04-15',
      firstFall: '10-15',
      provenance: 'fallback'
    });

    const card = buildAreaCard(snap, garden.id)!;
    expect(card.next?.label).toBe('Stake tomatoes');
    expect(buildFarmMapCard(snap).sections.map((s) => s.title)).toContain('Gardens');
  });

  it('marks typed frost dates as the owner’s', () => {
    const a = newOwner('Frosty');
    const snap = runWithTenant(a, () => {
      setSetting('last_frost_date', '04-28');
      return buildMapSnapshot();
    });
    expect(snap.frost).toMatchObject({
      lastSpring: '04-28',
      firstFall: '10-15',
      provenance: 'manual'
    });
  });

  it('never includes another Owner’s areas, plantings or tasks', () => {
    const now = Date.now();
    const a = newOwner('Farm A');
    const b = newOwner('Farm B');
    const farmA = seedFarm(a, now);
    seedFarm(b, now);
    const snapB = runWithTenant(b, () => buildMapSnapshot({ now }));
    expect(snapB.ownerId).toBe(b);
    expect(snapB.areas.some((x) => x.id === farmA.garden.id)).toBe(false);
    expect(snapB.plantings.some((p) => p.id === farmA.crop.id)).toBe(false);
    expect(snapB.blocks.some((x) => x.id === farmA.bed.id)).toBe(false);
    expect(snapB.tasks).toHaveLength(1);
  });
});

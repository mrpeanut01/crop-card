// @vitest-environment node
/**
 * #593: orchard calendars and this year's stage marks in the offline Card
 * snapshot. Only the calendars the farm's plantings resolve to ride along,
 * a mark moves the ETag, another Owner's marks never show, the bee line is
 * never snapshot data, and every shipped calendar planted at once stays
 * inside the snapshot budget.
 */

import { randomUUID } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { db } from '$lib/db/client';
import { owners, users } from '$lib/db/schema';
import { runWithTenant, runWithTenantAsync } from '$lib/db/tenant';
import { addPlanting, createBlock } from '$lib/db/blocks';
import { createField } from '$lib/db/fields';
import { setSetting } from '$lib/db/settings';
import { setStageMark } from '$lib/db/orchardCalendar';
import { FARM_PROFILE_KEY } from '$lib/onboarding/profile';
import { FARM_SNAPSHOT_VERSION } from '$lib/cards/snapshot';
import { orchardYear } from './orchardCalendar.server';
import { buildFarmSnapshot, snapshotEtag, snapshotStateKey } from './cardSnapshot';
import { getDataKinds } from './registry';

function newOwner(): string {
  const id = `orsnap-${randomUUID().slice(0, 8)}`;
  db.insert(owners).values({ id, name: id, slug: id, billingStatus: 'active' }).run();
  return id;
}

function plant(ownerId: string, crop: string, opts: { profile?: string } = {}) {
  return runWithTenant(ownerId, () => {
    if (opts.profile) setSetting(FARM_PROFILE_KEY, opts.profile);
    const area = createField({ name: `${crop} orchard`, kind: 'orchard' });
    const block = createBlock({ name: `${crop} row`, fieldId: area.id });
    const planting = addPlanting({
      blockId: block.id,
      cropPluginId: crop,
      varietyDisplayName: crop,
      plantingDate: Date.UTC(2024, 3, 1)
    });
    return { area, block, planting };
  });
}

const build = (ownerId: string) => runWithTenantAsync(ownerId, () => buildFarmSnapshot());

describe('orchard part of the card snapshot (#593)', () => {
  it('is absent on a farm with no tree fruit', async () => {
    const owner = newOwner();
    runWithTenant(owner, () => createBlock({ name: 'Bed' }));
    const snap = await build(owner);
    expect(snap.version).toBe(FARM_SNAPSHOT_VERSION);
    expect(FARM_SNAPSHOT_VERSION).toBe(8);
    expect(snap.orchard).toBeUndefined();
  });

  it("carries the planting's calendar only, its mark, and no bee line", async () => {
    const owner = newOwner();
    db.insert(users)
      .values({ id: 'orsnap-marker', email: 'orsnap-marker@example.test' })
      .onConflictDoNothing()
      .run();
    const { block, planting } = plant(owner, 'apple-gala', { profile: 'farm' });
    const year = runWithTenant(owner, () => orchardYear());
    runWithTenant(owner, () =>
      setStageMark(block.id, year, 'pome-va-2026', {
        stageId: 'pink',
        markedAt: Date.UTC(year, 3, 20),
        markedBy: 'orsnap-marker'
      })
    );
    const snap = await build(owner);
    const orchard = snap.orchard!;
    expect(orchard.year).toBe(year);
    expect(Object.keys(orchard.calendars)).toEqual(['pome-va-2026']);
    const row = orchard.plantings.find((r) => r.cropId === planting.id)!;
    expect(row.status).toBe('calendar');
    expect(row.audience.audience).toBe('commercial');
    expect(row.mark).toMatchObject({ stageId: 'pink', markedAt: Date.UTC(year, 3, 20) });
    expect(JSON.stringify(orchard)).not.toMatch(/beeLine|To avoid killing bees/);
    expect(JSON.stringify(orchard)).not.toContain('not-in-bloom');
  });

  it('drops a mark whose stage is not in the calendar (OR-2)', async () => {
    const owner = newOwner();
    const { block, planting } = plant(owner, 'apple-gala', { profile: 'farm' });
    const year = runWithTenant(owner, () => orchardYear());
    runWithTenant(owner, () =>
      setStageMark(block.id, year, 'pome-va-2026', {
        stageId: 'no-such-stage',
        markedAt: Date.UTC(year, 3, 20),
        markedBy: 'x'
      })
    );
    const row = (await build(owner)).orchard!.plantings.find((r) => r.cropId === planting.id)!;
    expect(row.mark).toBeNull();
  });

  it('moves the state key and the ETag when a stage is marked', async () => {
    const owner = newOwner();
    const { block } = plant(owner, 'peach-redhaven', { profile: 'farm' });
    const now = Date.now();
    const before = await runWithTenantAsync(owner, () => snapshotStateKey({ now, origin: null }));
    const etagBefore = snapshotEtag(await build(owner));
    const year = runWithTenant(owner, () => orchardYear());
    const calendarId = (await build(owner)).orchard!.plantings[0].calendarId!;
    runWithTenant(owner, () =>
      setStageMark(block.id, year, calendarId, { stageId: 'bloom', markedAt: now, markedBy: 'x' })
    );
    const after = await runWithTenantAsync(owner, () => snapshotStateKey({ now, origin: null }));
    expect(after).not.toBe(before);
    expect(snapshotEtag(await build(owner))).not.toBe(etagBefore);
  });

  it("never shows another Owner's marks", async () => {
    const a = newOwner();
    const b = newOwner();
    const pa = plant(a, 'apple-gala', { profile: 'farm' });
    plant(b, 'apple-gala', { profile: 'farm' });
    const year = runWithTenant(a, () => orchardYear());
    runWithTenant(a, () =>
      setStageMark(pa.block.id, year, 'pome-va-2026', {
        stageId: 'pink',
        markedAt: Date.now(),
        markedBy: 'x'
      })
    );
    const snapB = await build(b);
    expect(snapB.orchard!.plantings.every((r) => r.mark === null)).toBe(true);
    expect(JSON.stringify(snapB)).not.toContain(pa.block.id);
  });

  it('stays inside the snapshot budget with every shipped calendar planted', async () => {
    const owner = newOwner();
    const kinds = await getDataKinds();
    const crops = [...new Set(kinds.orchardCalendars.all().flatMap((c) => c.hostCropPluginIds))];
    runWithTenant(owner, () => setSetting(FARM_PROFILE_KEY, 'farm'));
    for (const crop of crops) plant(owner, crop);
    const garden = runWithTenant(owner, () => createField({ name: 'Yard', kind: 'garden' }));
    runWithTenant(owner, () => {
      const block = createBlock({ name: 'Yard trees', fieldId: garden.id });
      for (const crop of crops)
        addPlanting({
          blockId: block.id,
          cropPluginId: crop,
          varietyDisplayName: crop,
          plantingDate: Date.UTC(2024, 3, 1)
        });
    });
    const snap = await build(owner);
    const calendars = Object.keys(snap.orchard!.calendars).sort();
    expect(calendars).toEqual(
      kinds.orchardCalendars
        .all()
        .map((c) => c.pluginId)
        .sort()
    );
    const orchardGz = gzipSync(JSON.stringify(snap.orchard)).length;
    const totalGz = gzipSync(JSON.stringify(snap)).length;
    console.info(`[snapshot budget] orchard part ${orchardGz} bytes gzip, total ${totalGz}`);
    expect(orchardGz).toBeLessThanOrEqual(32 * 1024);
    expect(totalGz).toBeLessThanOrEqual(256 * 1024);
  });
});

// @vitest-environment node
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import { addPlanting, createBlock } from '$lib/db/blocks';
import { db } from '$lib/db/client';
import { getCrop, updateStatus } from '$lib/db/crops';
import { owners } from '$lib/db/schema';
import { runWithTenant } from '$lib/db/tenant';
import { closeSeason, seasonYearOf } from '$lib/server/seasonClose';

import { buildCloseoutPreflight, bulkResolvePlantings } from './closeout.server';

function freshOwner(): string {
  const id = `co-${randomUUID().slice(0, 12)}`;
  db.insert(owners).values({ id, name: id, slug: id, billingStatus: 'active' }).run();
  return id;
}

function seedSeason(year: number, n: number) {
  const block = createBlock({ name: 'Bed 1', acres: 0.1 });
  const ids: string[] = [];
  for (let i = 0; i < n; i++) {
    ids.push(
      addPlanting({
        blockId: block.id,
        cropPluginId: 'lettuce-buttercrunch',
        varietyDisplayName: 'Lettuce',
        plantingDate: new Date(year, 2, 1 + i).getTime()
      }).id
    );
  }
  return { block, ids };
}

describe('bulkResolvePlantings (#754)', () => {
  it('resolves every chosen open planting so the checklist clears, with bed and date listed', () => {
    const owner = freshOwner();
    runWithTenant(owner, () => {
      const { block, ids } = seedSeason(2041, 30);
      const before = buildCloseoutPreflight(2041);
      expect(before.unresolvedCount).toBe(30);
      expect(before.plantings[0].blockName).toBe(block.name);
      expect(before.plantings[0].plantingDate).not.toBeNull();

      const res = bulkResolvePlantings(2041, ids, 'harvested', new Date(2041, 9, 20).getTime());
      expect(res).toEqual({ ok: true, resolved: ids, skipped: [] });
      const after = buildCloseoutPreflight(2041);
      expect(after.plantingsResolved).toBe(true);
      expect(getCrop(ids[0])?.status).toBe('harvested');
    });
  });

  it('never touches resolved plantings, other years or another farm', () => {
    const mine = freshOwner();
    const theirs = freshOwner();
    const other = runWithTenant(theirs, () => seedSeason(2041, 1).ids[0]);
    runWithTenant(mine, () => {
      const { ids } = seedSeason(2041, 2);
      updateStatus(ids[1], 'failed');
      const nextYear = seedSeason(2042, 1).ids[0];
      const res = bulkResolvePlantings(2041, [ids[0], ids[1], nextYear, other], 'archived');
      expect(res).toEqual({ ok: true, resolved: [ids[0]], skipped: [ids[1], nextYear, other] });
      expect(getCrop(ids[1])?.status).toBe('failed');
      expect(getCrop(nextYear)?.status).not.toBe('archived');
    });
    runWithTenant(theirs, () => expect(getCrop(other)?.status).not.toBe('archived'));
  });

  it('stamps the harvest inside the season when closing a past year', () => {
    const owner = freshOwner();
    runWithTenant(owner, () => {
      const { ids } = seedSeason(2041, 1);
      bulkResolvePlantings(2041, ids, 'harvested', new Date(2043, 0, 15).getTime());
      const harvestedAt = getCrop(ids[0])?.harvestedAt;
      expect(harvestedAt).toBeTruthy();
      expect(seasonYearOf(new Date(harvestedAt!).getTime())).toBe(2041);
    });
  });

  it('is refused once the season is closed', () => {
    const owner = freshOwner();
    runWithTenant(owner, () => {
      const { ids } = seedSeason(2041, 1);
      closeSeason({
        year: 2041,
        plantingResolutions: [],
        harvestRollup: {},
        pendingCount: 0
      });
      expect(bulkResolvePlantings(2041, ids, 'harvested')).toEqual({
        ok: false,
        code: 'SEASON_CLOSED',
        year: 2041
      });
      expect(getCrop(ids[0])?.status).not.toBe('harvested');
    });
  });
});

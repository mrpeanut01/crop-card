// @vitest-environment node
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { db } from '$lib/db/client';
import { owners } from '$lib/db/schema';
import { runWithTenantAsync } from '$lib/db/tenant';
import { createField } from '$lib/db/fields';
import { insertAnimalGroup } from '$lib/db/animalGroups';
import { applyMove, planMove } from '$lib/server/animals';
import { buildYearAnimalSection } from './yearSummaryAnimals.server';

const DAY = 86_400_000;

describe('buildYearAnimalSection with a group split', () => {
  it('keeps the start count and records no arrival for the split-off group', async () => {
    const ownerId = `ysplit-${randomUUID()}`;
    db.insert(owners)
      .values({ id: ownerId, name: ownerId, slug: ownerId, billingStatus: 'active' })
      .run();
    const year = new Date().getUTCFullYear();
    const fromMs = Date.UTC(year, 0, 1);
    const toMs = Date.UTC(year + 1, 0, 1) - 1;
    const section = await runWithTenantAsync(ownerId, async () => {
      const coop = createField({ name: 'Coop', kind: 'coop_pen' });
      const run = createField({ name: 'Run', kind: 'coop_pen' });
      const flock = insertAnimalGroup(
        {
          name: 'Hens',
          speciesId: 'chicken',
          purpose: 'production',
          headCount: 20,
          foodProducing: true,
          housingFieldId: coop.id
        },
        fromMs - 100 * DAY
      );
      applyMove(
        planMove({
          subjectType: 'group',
          subjectId: flock.id,
          fieldId: run.id,
          count: 5,
          newGroupName: 'Split hens'
        }),
        { movedBy: null }
      );
      return buildYearAnimalSection({ fromMs, toMs });
    });
    expect(section!.headCounts).toEqual([{ speciesId: 'chicken', atStart: 20, atEnd: 20 }]);
    expect(section!.movements.filter((m) => m.kind === 'arrived')).toEqual([]);
  });
});

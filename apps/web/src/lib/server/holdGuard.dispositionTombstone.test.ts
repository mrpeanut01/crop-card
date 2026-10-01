// @vitest-environment node
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { db } from '$lib/db/client';
import { owners, recordDeletions } from '$lib/db/schema';
import { runWithTenant, runWithTenantAsync, tenantValues } from '$lib/db/tenant';
import { listApplicationTombstones } from '$lib/db/admin';
import { seedPhase33 } from '$lib/db/phase33.fixtures';
import { projectActiveFarm } from './holdGuard';

/** A-09: a `harvest-disposition` tombstone is never a hold fact, even when
 *  its snapshot looks like an application. */
describe('harvest-disposition tombstones', () => {
  it('are never read by listApplicationTombstones or the hold projection', async () => {
    const ownerId = `disp-tomb-${randomUUID()}`;
    db.insert(owners)
      .values({ id: ownerId, name: ownerId, slug: ownerId, billingStatus: 'active' })
      .run();
    const seed = seedPhase33(ownerId, 'disp-tomb');
    const now = Date.now();
    const snapshot = JSON.stringify({
      id: seed.rowIds.harvest_dispositions,
      blockId: seed.subjects.block,
      occurredAt: now - 3_600_000,
      products: [{ pluginId: 'herbicide:grazon-next-hl', name: 'GrazonNext HL' }]
    });
    const tomb = (recordKind: 'harvest-disposition' | 'spray') =>
      runWithTenant(ownerId, () =>
        db
          .insert(recordDeletions)
          .values(
            tenantValues({
              id: randomUUID(),
              recordKind,
              recordId: randomUUID(),
              reason: 'test',
              snapshotJson: snapshot
            })
          )
          .run()
      );

    const before = await runWithTenantAsync(ownerId, () =>
      projectActiveFarm('America/New_York', now)
    );
    tomb('harvest-disposition');
    const after = await runWithTenantAsync(ownerId, () =>
      projectActiveFarm('America/New_York', now)
    );
    expect(after.loaded.facts).toEqual(before.loaded.facts);
    expect(JSON.stringify(after.projection)).toBe(JSON.stringify(before.projection));
    expect(runWithTenant(ownerId, () => listApplicationTombstones(0))).toEqual([]);

    tomb('spray');
    expect(runWithTenant(ownerId, () => listApplicationTombstones(0))).toHaveLength(1);
  });
});

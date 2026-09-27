// @vitest-environment node
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { db } from '$lib/db/client';
import { equipment, owners, users } from '$lib/db/schema';
import { runWithTenant, tenantValues } from '$lib/db/tenant';
import { createField } from '$lib/db/fields';
import { createBlock, listBlocks } from '$lib/db/blocks';
import { insertSprayEvent } from '$lib/db/sprayEvents';
import { insertGrazingAttestation } from '$lib/db/grazingAttestations';
import { DAY_MS } from '$lib/safety/grazingInterval';
import { blockReassignRefusal, buildGrazingByArea, loadAreaGrazing } from './areaGrazing';

const TZ = 'America/New_York';

function seed(daysAgo: number) {
  const ownerId = `grazing-${randomUUID()}`;
  const userId = `user-${randomUUID()}`;
  db.insert(owners)
    .values({ id: ownerId, name: ownerId, slug: ownerId, billingStatus: 'active' })
    .run();
  db.insert(users)
    .values({ id: userId, email: `${userId}@test.local` })
    .run();
  return runWithTenant(ownerId, () => {
    const pasture = createField({ name: 'North pasture', kind: 'pasture' });
    const barn = createField({ name: 'Barn', kind: 'barn' });
    const block = createBlock({ name: 'Paddock 1', fieldId: pasture.id, acres: 1 });
    const sprayerId = `${ownerId}-sprayer`;
    db.insert(equipment)
      .values(tenantValues({ id: sprayerId, type: 'sprayer' as const, label: 'Sprayer' }))
      .run();
    const spray = insertSprayEvent({
      blockId: block.id,
      sprayerId,
      performedById: userId,
      occurredAt: Date.now() - daysAgo * DAY_MS,
      products: [{ pluginId: 'no-such-plugin', chemistryClasses: ['glyphosate'] }],
      conditions: { tempF: 70, windMph: 5, rainForecastMmNext24h: 0 },
      rulesVersion: 'test',
      pluginHashes: {}
    });
    return {
      ownerId,
      pastureId: pasture.id,
      barnId: barn.id,
      blockId: block.id,
      sprayId: spray.id
    };
  });
}

describe('area grazing loader', () => {
  it('holds a pasture with an unsourced application and no other Area', async () => {
    const s = seed(3);
    const byArea = await runWithTenant(s.ownerId, () => loadAreaGrazing(listBlocks(), TZ));
    expect(Object.keys(byArea)).toEqual([s.pastureId]);
    expect(byArea[s.pastureId].graze?.state).toBe('unknown');
    expect(byArea[s.pastureId].hay?.state).toBe('unknown');
  });

  it("never sees another Owner's applications", async () => {
    const mine = seed(3);
    const theirs = seed(3);
    const byArea = await runWithTenant(mine.ownerId, () => loadAreaGrazing(listBlocks(), TZ));
    expect(byArea[theirs.pastureId]).toBeUndefined();
    const refusal = await runWithTenant(mine.ownerId, () =>
      blockReassignRefusal(theirs.blockId, TZ)
    );
    expect(refusal).toBeNull();
  });

  it('an owner attestation turns the hold into a date, then clears it', async () => {
    const s = seed(3);
    const byArea = await runWithTenant(s.ownerId, () => {
      insertGrazingAttestation({
        fieldId: s.pastureId,
        sprayEventRef: `spray:${s.sprayId}`,
        productPluginId: 'no-such-plugin',
        grazeDays: 10,
        hayDays: 1,
        lactatingGrazeDays: 10,
        reason: 'read from the label',
        attestedBy: null
      });
      return loadAreaGrazing(listBlocks(), TZ);
    });
    expect(byArea[s.pastureId]).toMatchObject({
      graze: { state: 'dated' },
      hay: null,
      attested: true
    });
    const later = await runWithTenant(s.ownerId, () =>
      loadAreaGrazing(listBlocks(), TZ, Date.now() + 30 * DAY_MS)
    );
    expect(later).toEqual({});
  });

  it('refuses to move a held block to another Area and allows it once out of the window', async () => {
    const held = seed(3);
    expect(
      await runWithTenant(held.ownerId, () => blockReassignRefusal(held.blockId, TZ))
    ).toMatchObject({ error: 'BLOCK_HAS_GRAZING_HOLD' });
    const old = seed(400);
    expect(
      await runWithTenant(old.ownerId, () => blockReassignRefusal(old.blockId, TZ))
    ).toBeNull();
  });

  it('buildGrazingByArea skips blocks with no Area', () => {
    const out = buildGrazingByArea({
      context: {
        applications: [
          {
            ref: 'spray:x',
            source: 'spray',
            blockId: 'orphan',
            appliedAtMs: Date.now(),
            productPluginId: null,
            productName: 'X',
            restrictions: null
          }
        ],
        attestations: [],
        registryMaxIntervalDays: 0
      },
      blocks: [{ id: 'orphan', fieldId: null }],
      nowMs: Date.now(),
      timeZone: TZ
    });
    expect(out).toEqual({});
  });
});

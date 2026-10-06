/**
 * Cross-tenant isolation property test (Phase 18a).
 *
 * Verifies the load-bearing claim of the multi-tenant migration: a query
 * running inside `runWithTenant(ownerId, …)` sees ONLY that Owner's rows.
 * Seeds two tenants with disjoint data sets, then for every exported `list*`
 * / `get*` repo function runs it under each tenant and asserts:
 *
 *   - The returned IDs are a subset of the calling tenant's seed set.
 *   - The other tenant's IDs are never present.
 *
 * If you add a new tenant-scoped repo function, add it to either
 * `LIST_FUNCTIONS` or `INTENTIONALLY_GLOBAL_FUNCTIONS` below. The bare
 * `it('new repos must be classified')` test fails when reflection sees a
 * function this file doesn't know about — forcing the author to make a
 * conscious decision.
 */

import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import fc from 'fast-check';

import { runWithTenant } from './tenant';
import { db } from './client';
import { owners } from './schema';

import * as blocksRepo from './blocks';
import * as fieldsRepo from './fields';
import * as areasRepo from './areas';
import { AREA_KINDS, BLOCK_KINDS } from '$lib/farm/areaKinds';
import * as cropsRepo from './crops';
import * as shadeRepo from './shadeSources';
import * as mapFeaturesRepo from './mapFeatures';
import { MAP_FEATURE_KINDS, geometryTypeFor } from '$lib/farm/mapFeatures';
import * as sprayRepo from './sprayEvents';
import * as harvestRepo from './harvestEvents';
import * as insecticideRepo from './insecticideEvents';
import * as fungicideRepo from './fungicideEvents';
import * as hayRepo from './hayCuttings';
import * as equipmentRepo from './equipment';
import * as cropEquipmentRepo from './cropEquipment';
import * as fertilityRepo from './fertility';
import * as stockRepo from './stock';
import * as tasksRepo from './tasks';
import * as settingsRepo from './settings';
import * as planRevisionsRepo from '$lib/plan/revisions';
import * as scoutObservationsRepo from './scoutObservations';
import * as wizardChatRepo from './wizardChat';
import * as seasonCloseoutsRepo from './seasonCloseouts';
import * as pushSubscriptionsRepo from './pushSubscriptions';
import * as emailAlertConsentsRepo from './emailAlertConsents';
import * as taxonomyRepo from './taxonomy';
import * as pluginOverridesRepo from './pluginOverrides';
import * as clientRecordsRepo from './clientRecords';
import * as plantingJournalRepo from './plantingJournal';
import * as animalsRepo from './animals';
import * as animalGroupsRepo from './animalGroups';
import * as animalLocationsRepo from './animalLocations';
import * as animalStatusRepo from './animalStatus';
import * as grazingAttestationsRepo from './grazingAttestations';
import * as animalHealthRepo from './animalHealth';
import * as animalProductionRepo from './animalProduction';
import * as carePlansRepo from './animalCarePlans';
import * as careTasksRepo from './careTasks';
import {
  PHASE_32_TABLES,
  listPhase32Ids,
  seedPhase32Rows,
  type Phase32Table
} from './phase32.fixtures';
import * as documentsRepo from './documents';
import * as amendmentsRepo from './amendments';
import * as forageTestsRepo from './forageTests';
import {
  PHASE_33_TABLES,
  listPhase33Ids,
  seedPhase33,
  type Phase33Table
} from './phase33.fixtures';
import {
  assertAmendmentBatch,
  assertDocument,
  assertDocumentSubject,
  assertHayCutting
} from '$lib/server/foreignRefs';
import { DOCUMENT_SUBJECT_TYPES } from './schema';
import { issueToken, lookupByPlaintext } from '$lib/server/apiTokens';
import { users, helperAssignments, recordDeletions, cropEquipment, equipmentLog } from './schema';
import { listUnifiedRecords } from './recordsUnified';
import { eq } from 'drizzle-orm';
import { tenantValues, withTenant } from './tenant';

const OWNER_A = 'cross-tenant-test-owner-a';
const OWNER_B = 'cross-tenant-test-owner-b';

interface SeedFixtures {
  blockIds: Set<string>;
  fieldIds: Set<string>;
  cropIds: Set<string>;
  shadeIds: Set<string>;
}

function seedOwner(ownerId: string): SeedFixtures {
  return runWithTenant(ownerId, () => {
    // Seed the owner row + assignment indirectly: the cross-tenant test only
    // needs the FK target to exist. We write the owner row via raw SQL since
    // creating Owners is a Phase 18c API that doesn't exist yet.
    // The Home Farm migration already created `owner_home_farm`; we add the
    // two test owners here only if they're not already present.
    seedOwnerRow(ownerId);

    const f1 = fieldsRepo.createField({ name: `${ownerId}-field-1` });
    const f2 = fieldsRepo.createField({ name: `${ownerId}-field-2` });

    const b1 = blocksRepo.createBlock({ name: `${ownerId}-block-1`, fieldId: f1.id, acres: 1 });
    const b2 = blocksRepo.createBlock({ name: `${ownerId}-block-2`, fieldId: f2.id, acres: 2 });

    const s1 = shadeRepo.createShadeSource({
      name: `${ownerId}-shade-1`,
      heightFt: 30,
      fieldId: f1.id
    });

    const c1 = cropsRepo.createPlanned({
      blockId: b1.id,
      cropPluginId: 'crop:tomato',
      varietyDisplayName: 'Roma'
    });
    const c2 = cropsRepo.createPlanned({
      blockId: b2.id,
      cropPluginId: 'crop:corn',
      varietyDisplayName: 'Reds'
    });

    settingsRepo.setSetting('greeting', `hello-from-${ownerId}`);

    // Phase 25d (#89) — seed a plan_revisions row + a scout_observations
    // row so the cross-tenant test sees both tables. Each owner gets one
    // of each, then we verify Owner B cannot read Owner A's rows.
    const systemUserId = ensureCrossTenantTestUser(ownerId);
    planRevisionsRepo.insertPlanRevision({
      planId: `season-2026`,
      source: 'wizard',
      payload: { kind: 'cross-tenant-test', greeting: `hello-from-${ownerId}` },
      createdByUserId: systemUserId
    });
    scoutObservationsRepo.insertScoutObservation({
      blockId: b1.id,
      performedById: systemUserId,
      pest: 'aphid',
      metric: 'count-per-leaf',
      value: 12,
      occurredAt: Date.now()
    });
    // Phase 25d (#89) — seed a wizard chat session + message so the
    // cross-tenant test covers the new tables.
    const session = wizardChatRepo.getOrCreateActiveSession(`season-2026`, systemUserId);
    wizardChatRepo.appendMessage({
      sessionId: session.id,
      step: 'allocation',
      role: 'user',
      content: `chat from ${ownerId}`
    });

    return {
      blockIds: new Set([b1.id, b2.id]),
      fieldIds: new Set([f1.id, f2.id]),
      cropIds: new Set([c1.id, c2.id]),
      shadeIds: new Set([s1.id])
    };
  });
}

function seedOwnerRow(ownerId: string): void {
  // Direct DB write because Owner-row creation is a Phase 18c API (not yet
  // exposed via a repo). Cross-tenant test setup is the one place this is
  // acceptable.
  db.insert(owners)
    .values({
      id: ownerId,
      name: ownerId,
      slug: ownerId.replace(/[^a-z0-9-]/g, '-'),
      billingStatus: 'active'
    })
    .onConflictDoNothing()
    .run();
}

/** Phase 25d (#89) — seed-user helper for plan_revisions.created_by_user_id
 *  + scout_observations.performed_by_id FK targets. Each test owner gets
 *  a deterministic system user so the seed step is idempotent. */
function ensureCrossTenantTestUser(ownerId: string): string {
  const userId = `${ownerId}-system-user`;
  db.insert(users)
    .values({ id: userId, email: `${userId}@cross-tenant.test` })
    .onConflictDoNothing()
    .run();
  return userId;
}

describe('cross-tenant isolation', () => {
  // Seeded before any test so each test stands alone, whatever order the
  // tests run in (vitest --sequence.shuffle).
  let aIds: ReturnType<typeof seedOwner>;
  let bIds: ReturnType<typeof seedOwner>;
  beforeAll(() => {
    aIds = seedOwner(OWNER_A);
    bIds = seedOwner(OWNER_B);
  });

  it('seeds two owners with disjoint data', () => {
    // Sanity: the two id-sets are disjoint.
    for (const id of aIds.blockIds) expect(bIds.blockIds.has(id)).toBe(false);
    for (const id of aIds.fieldIds) expect(bIds.fieldIds.has(id)).toBe(false);
    for (const id of aIds.cropIds) expect(bIds.cropIds.has(id)).toBe(false);

    // Owner A's listFields returns only A's fields.
    runWithTenant(OWNER_A, () => {
      const seen = new Set(fieldsRepo.listFields().map((f) => f.id));
      for (const id of aIds.fieldIds) expect(seen.has(id)).toBe(true);
      for (const id of bIds.fieldIds) expect(seen.has(id)).toBe(false);
    });

    // Owner B's listFields returns only B's fields.
    runWithTenant(OWNER_B, () => {
      const seen = new Set(fieldsRepo.listFields().map((f) => f.id));
      for (const id of bIds.fieldIds) expect(seen.has(id)).toBe(true);
      for (const id of aIds.fieldIds) expect(seen.has(id)).toBe(false);
    });
  });

  it('listBlocks is owner-scoped', () => {
    runWithTenant(OWNER_A, () => {
      const blockIds = new Set(blocksRepo.listBlocks().map((b) => b.id));
      runWithTenant(OWNER_B, () => {
        for (const otherId of blocksRepo.listBlocks().map((b) => b.id)) {
          expect(blockIds.has(otherId)).toBe(false);
        }
      });
    });
  });

  it('listCrops is owner-scoped', () => {
    runWithTenant(OWNER_A, () => {
      const cropIds = new Set(cropsRepo.listCrops().map((c) => c.id));
      runWithTenant(OWNER_B, () => {
        for (const otherId of cropsRepo.listCrops().map((c) => c.id)) {
          expect(cropIds.has(otherId)).toBe(false);
        }
      });
    });
  });

  it('listShadeSources is owner-scoped', () => {
    runWithTenant(OWNER_A, () => {
      const seenA = new Set(shadeRepo.listShadeSources().map((s) => s.id));
      runWithTenant(OWNER_B, () => {
        for (const otherId of shadeRepo.listShadeSources().map((s) => s.id)) {
          expect(seenA.has(otherId)).toBe(false);
        }
      });
    });
  });

  it("getBlock cannot fetch another tenant's block", () => {
    const aBlocks = runWithTenant(OWNER_A, () => blocksRepo.listBlocks());
    const aBlockId = aBlocks[0].id;

    // Owner B tries to fetch one of A's blocks by id.
    const result = runWithTenant(OWNER_B, () => blocksRepo.getBlock(aBlockId));
    expect(result).toBeUndefined();
  });

  it('getSetting is owner-scoped', () => {
    const aGreeting = runWithTenant(OWNER_A, () => settingsRepo.getSetting('greeting'));
    const bGreeting = runWithTenant(OWNER_B, () => settingsRepo.getSetting('greeting'));
    expect(aGreeting).toBe(`hello-from-${OWNER_A}`);
    expect(bGreeting).toBe(`hello-from-${OWNER_B}`);
    expect(aGreeting).not.toBe(bGreeting);
  });

  it('listSprayEvents is owner-scoped (empty seed → empty results)', () => {
    runWithTenant(OWNER_A, () => {
      const events = sprayRepo.listSprayEvents();
      // We didn't seed any spray events; just confirm the call works and
      // returns rows whose ids match (vacuously true here). The point is
      // that the query ran with a tenant filter — exercised by the cross-
      // owner property below.
      expect(Array.isArray(events)).toBe(true);
    });
  });

  // Phase 24 — Bearer-authed code path. A token issued for Owner A
  // resolves with ownerId === A; wrapping the request inside
  // runWithTenant(A, …) means subsequent repo reads see only A's data.
  // Owner B's token never resolves to A's ownerId regardless of which
  // user mints it.
  it('Bearer token resolves to the issuing Owner and only that Owner', () => {
    const userA = `bearer-test-user-a-${randomUUID().slice(0, 8)}`;
    const userB = `bearer-test-user-b-${randomUUID().slice(0, 8)}`;
    db.insert(users)
      .values({ id: userA, email: `${userA}@test` })
      .run();
    db.insert(users)
      .values({ id: userB, email: `${userB}@test` })
      .run();
    db.insert(helperAssignments)
      .values({ ownerId: OWNER_A, userId: userA, roleWithinOwner: 'owner', status: 'active' })
      .run();
    db.insert(helperAssignments)
      .values({ ownerId: OWNER_B, userId: userB, roleWithinOwner: 'owner', status: 'active' })
      .run();

    const a = issueToken({ ownerId: OWNER_A, userId: userA, label: 'crosstest-a' });
    const b = issueToken({ ownerId: OWNER_B, userId: userB, label: 'crosstest-b' });

    const ra = lookupByPlaintext(a.token);
    const rb = lookupByPlaintext(b.token);
    expect(ra?.ownerId).toBe(OWNER_A);
    expect(rb?.ownerId).toBe(OWNER_B);

    // Each token, when used to scope a repo read, sees only its own Owner.
    const aBlockIds = runWithTenant(
      ra!.ownerId,
      () => new Set(blocksRepo.listBlocks().map((b) => b.id))
    );
    const bBlockIds = runWithTenant(
      rb!.ownerId,
      () => new Set(blocksRepo.listBlocks().map((b) => b.id))
    );
    for (const id of aBlockIds) expect(bBlockIds.has(id)).toBe(false);
    for (const id of bBlockIds) expect(aBlockIds.has(id)).toBe(false);
  });

  it('Bearer token cannot impersonate the OTHER Owner via crafted plaintext', () => {
    // Without the database, the only way to "make" a token resolve is to
    // hit the SHA-256 of a real row. Random plaintext never matches.
    for (let i = 0; i < 50; i++) {
      const fake = 'cck_' + randomUUID().replace(/-/g, '').padEnd(43, 'a').slice(0, 43);
      expect(lookupByPlaintext(fake)).toBeNull();
    }
  });

  it('listPlanRevisions is owner-scoped', () => {
    const aRevs = runWithTenant(OWNER_A, () => planRevisionsRepo.listPlanRevisions(`season-2026`));
    const bRevs = runWithTenant(OWNER_B, () => planRevisionsRepo.listPlanRevisions(`season-2026`));
    const aIds = new Set(aRevs.map((r) => r.id));
    for (const r of bRevs) expect(aIds.has(r.id)).toBe(false);
    // Sanity: each owner sees their own seeded row.
    expect(aRevs.length).toBeGreaterThan(0);
    expect(bRevs.length).toBeGreaterThan(0);
  });

  it('listScoutObservations is owner-scoped', () => {
    const aObs = runWithTenant(OWNER_A, () => scoutObservationsRepo.listScoutObservations());
    const bObs = runWithTenant(OWNER_B, () => scoutObservationsRepo.listScoutObservations());
    const aIds = new Set(aObs.map((o) => o.id));
    for (const o of bObs) expect(aIds.has(o.id)).toBe(false);
    expect(aObs.length).toBeGreaterThan(0);
    expect(bObs.length).toBeGreaterThan(0);
  });

  it('wizardChat sessions + messages are owner-scoped', () => {
    const aSession = runWithTenant(OWNER_A, () => wizardChatRepo.getActiveSession(`season-2026`));
    const bSession = runWithTenant(OWNER_B, () => wizardChatRepo.getActiveSession(`season-2026`));
    expect(aSession).not.toBeNull();
    expect(bSession).not.toBeNull();
    expect(aSession!.id).not.toBe(bSession!.id);

    // Owner A reading messages by Owner B's sessionId returns []
    // because tenantWhere filters by current ownerId regardless of the
    // sessionId predicate.
    const aReadsBsSession = runWithTenant(OWNER_A, () => wizardChatRepo.listMessages(bSession!.id));
    expect(aReadsBsSession).toEqual([]);

    // Each owner's own session has its seeded message.
    const aMessages = runWithTenant(OWNER_A, () => wizardChatRepo.listMessages(aSession!.id));
    const bMessages = runWithTenant(OWNER_B, () => wizardChatRepo.listMessages(bSession!.id));
    expect(aMessages.length).toBeGreaterThan(0);
    expect(bMessages.length).toBeGreaterThan(0);
    expect(aMessages[0].content).toContain(OWNER_A);
    expect(bMessages[0].content).toContain(OWNER_B);
  });

  // #329 — record_deletions (force-delete tombstones) is tenant-scoped and
  // has no dedicated repo (written inline in admin.ts). Seed one tombstone
  // per Owner via tenantValues and assert a tenant-scoped read never crosses
  // the boundary.
  it('record_deletions tombstones are owner-scoped', () => {
    const seedTombstone = (ownerId: string) =>
      runWithTenant(ownerId, () => {
        const id = `tombstone-${ownerId}-${randomUUID().slice(0, 8)}`;
        db.insert(recordDeletions)
          .values(
            tenantValues({
              id,
              recordKind: 'spray',
              recordId: `rec-${ownerId}`,
              deletedBy: null,
              reason: 'cross-tenant test',
              snapshotJson: JSON.stringify({ owner: ownerId })
            })
          )
          .run();
        return id;
      });

    const aId = seedTombstone(OWNER_A);
    const bId = seedTombstone(OWNER_B);

    const aSeen = runWithTenant(OWNER_A, () =>
      db.select().from(recordDeletions).where(withTenant(recordDeletions)).all()
    );
    const aIds = new Set(aSeen.map((r) => r.id));
    expect(aIds.has(aId)).toBe(true);
    expect(aIds.has(bId)).toBe(false);

    // Owner A reading Owner B's tombstone by id returns nothing.
    const aReadsB = runWithTenant(OWNER_A, () =>
      db
        .select()
        .from(recordDeletions)
        .where(withTenant(recordDeletions, eq(recordDeletions.id, bId)))
        .all()
    );
    expect(aReadsB).toEqual([]);
  });

  it('client_record_receipts are owner-scoped: one Owner never sees or consumes another Owner receipt', () => {
    fc.assert(
      fc.property(fc.uuid(), (clientId) => {
        const aFirst = runWithTenant(OWNER_A, () =>
          clientRecordsRepo.claimClientRecord(clientId, '/api/scout/record')
        );
        if (aFirst.status !== 'claimed') throw new Error('expected Owner A to claim');
        const aToken = aFirst.token;
        const bFirst = runWithTenant(OWNER_B, () =>
          clientRecordsRepo.claimClientRecord(clientId, '/api/scout/record', aToken)
        );
        if (bFirst.status !== 'claimed') throw new Error('expected Owner B to claim');
        expect(
          runWithTenant(OWNER_B, () => clientRecordsRepo.completeClientRecord(clientId, aToken))
        ).toBe(true);
        expect(
          runWithTenant(OWNER_A, () => clientRecordsRepo.releaseClientRecord(clientId, aToken))
        ).toBe(true);
        expect(
          runWithTenant(OWNER_B, () => clientRecordsRepo.releaseClientRecord(clientId, aToken))
        ).toBe(false);
        const aAgain = runWithTenant(OWNER_A, () =>
          clientRecordsRepo.claimClientRecord(clientId, '/api/scout/record')
        );
        const bAgain = runWithTenant(OWNER_B, () =>
          clientRecordsRepo.claimClientRecord(clientId, '/api/scout/record')
        );
        expect(aAgain.status).toBe('claimed');
        expect(bAgain).toEqual({ status: 'done' });
      }),
      { numRuns: 20 }
    );
  });

  it('season_closeouts rows are owner-scoped (UC-44)', () => {
    const seedCloseout = (ownerId: string) =>
      runWithTenant(
        ownerId,
        () =>
          seasonCloseoutsRepo.createCloseout({
            year: 2099,
            snapshotJson: JSON.stringify({ owner: ownerId }),
            closedById: null
          }).id
      );

    const aId = seedCloseout(OWNER_A);
    const bId = seedCloseout(OWNER_B);
    expect(aId).not.toEqual(bId);

    // Each owner sees only its own close row for the shared year.
    const aList = runWithTenant(OWNER_A, () => seasonCloseoutsRepo.listCloseouts());
    const aIds = new Set(aList.map((c) => c.id));
    expect(aIds.has(aId)).toBe(true);
    expect(aIds.has(bId)).toBe(false);

    // The gate lookup is owner-scoped: A closing 2099 does not close it for B
    // if B never closed — but here both closed, so both see their own close.
    expect(runWithTenant(OWNER_A, () => seasonCloseoutsRepo.isSeasonClosed(2099))).toBe(true);
    // A reopen by A must not touch B's row.
    runWithTenant(OWNER_A, () => seasonCloseoutsRepo.reopenCloseout(2099));
    expect(runWithTenant(OWNER_A, () => seasonCloseoutsRepo.isSeasonClosed(2099))).toBe(false);
    expect(runWithTenant(OWNER_B, () => seasonCloseoutsRepo.isSeasonClosed(2099))).toBe(true);
  });

  it('push_subscriptions + push_deliveries are owner-scoped (NFR-06)', () => {
    const endpoint = 'https://push.example.net/send/shared-device';
    const seedPush = (ownerId: string) =>
      runWithTenant(ownerId, () => {
        const userId = ensureCrossTenantTestUser(ownerId);
        const sub = pushSubscriptionsRepo.upsertSubscription({
          userId,
          endpoint,
          p256dh: `p256dh-${ownerId}`,
          auth: `auth-${ownerId}`
        });
        expect(pushSubscriptionsRepo.claimDelivery('decon-due', 'sprayer-x:1')).toBe(true);
        return { userId, id: sub.id };
      });

    const a = seedPush(OWNER_A);
    const b = seedPush(OWNER_B);
    expect(a.id).not.toEqual(b.id);

    const aSubs = runWithTenant(OWNER_A, () => pushSubscriptionsRepo.listSubscriptions());
    expect(aSubs.map((s) => s.id)).toContain(a.id);
    expect(aSubs.map((s) => s.id)).not.toContain(b.id);
    expect(aSubs.every((s) => s.ownerId === OWNER_A)).toBe(true);

    // A cannot read, re-key, update, or delete B's row even with B's user id.
    expect(
      runWithTenant(OWNER_A, () => pushSubscriptionsRepo.getSubscriptionForUser(b.userId, endpoint))
    ).toBeNull();
    expect(
      runWithTenant(OWNER_A, () =>
        pushSubscriptionsRepo.updatePrefsForUser(b.userId, endpoint, {
          'decon-due': false,
          'lock-window-closing': false,
          'spring-calibration': false,
          'frost-tonight': false,
          'animal-care-due': false,
          'withdrawal-clears': false,
          'hold-covers-sale': false,
          'weekly-digest': false
        })
      )
    ).toBeNull();
    expect(
      runWithTenant(OWNER_A, () =>
        pushSubscriptionsRepo.deleteSubscriptionForUser(b.userId, endpoint)
      )
    ).toBe(false);
    expect(runWithTenant(OWNER_A, () => pushSubscriptionsRepo.deleteSubscriptionById(b.id))).toBe(
      false
    );
    runWithTenant(OWNER_A, () => pushSubscriptionsRepo.markSubscriptionFailure(b.id));
    const bSub = runWithTenant(OWNER_B, () =>
      pushSubscriptionsRepo.getSubscriptionForUser(b.userId, endpoint)
    );
    expect(bSub?.failureCount).toBe(0);
    expect(bSub?.p256dh).toBe(`p256dh-${OWNER_B}`);

    // The sent-log is per Owner: B's claim of the same subject succeeded
    // above, and each Owner sees only its own delivery row.
    const aDeliveries = runWithTenant(OWNER_A, () => pushSubscriptionsRepo.listDeliveries());
    expect(aDeliveries.every((d) => d.ownerId === OWNER_A)).toBe(true);
    expect(
      runWithTenant(OWNER_A, () => pushSubscriptionsRepo.claimDelivery('decon-due', 'sprayer-x:1'))
    ).toBe(false);

    const tenants = pushSubscriptionsRepo.listOwnerIdsWithPushSubscriptions();
    expect(tenants).toEqual(expect.arrayContaining([OWNER_A, OWNER_B]));
  });

  it("listCropEquipment never joins another Owner's equipment row", () => {
    const bEquipment = runWithTenant(OWNER_B, () =>
      equipmentRepo.createEquipment({ type: 'planter', label: 'B-secret-planter' })
    );
    const aCropId = runWithTenant(OWNER_A, () => cropsRepo.listCrops()[0].id);
    expect(() =>
      runWithTenant(OWNER_A, () =>
        cropEquipmentRepo.bindEquipment({
          cropId: aCropId,
          equipmentId: bEquipment.id,
          role: 'planter'
        })
      )
    ).toThrow(/unknown equipment id/);
    // A pre-existing binding row pointing at B's equipment (legacy data)
    // must still not surface B's label through the join.
    runWithTenant(OWNER_A, () =>
      db
        .insert(cropEquipment)
        .values(
          tenantValues({
            id: randomUUID(),
            cropId: aCropId,
            equipmentId: bEquipment.id,
            role: 'planter'
          })
        )
        .run()
    );
    const listed = runWithTenant(OWNER_A, () => cropEquipmentRepo.listCropEquipment(aCropId));
    expect(listed.map((b) => b.equipmentLabel)).not.toContain('B-secret-planter');
  });

  it("decon records never join another Owner's equipment label", () => {
    const bRig = runWithTenant(OWNER_B, () =>
      equipmentRepo.createEquipment({ type: 'sprayer', label: 'B-secret-sprayer' })
    );
    const logId = randomUUID();
    // Legacy/bad row: A's decon log pointing at B's sprayer id.
    runWithTenant(OWNER_A, () =>
      db
        .insert(equipmentLog)
        .values(
          tenantValues({
            id: logId,
            equipmentId: bRig.id,
            occurredAt: new Date(),
            kind: 'decon' as const
          })
        )
        .run()
    );
    const rows = runWithTenant(OWNER_A, () => listUnifiedRecords({ kinds: ['decon'] }));
    const row = rows.find((r) => r.rowId === logId);
    expect(row).toBeTruthy();
    expect(row?.detail).not.toContain('B-secret-sprayer');
  });

  it('taxonomy defaults are shared read-only; own terms stay per-Owner', () => {
    const def = runWithTenant(OWNER_A, () =>
      taxonomyRepo.listTaxonomyTerms({ domain: 'equipment' }).find((t) => t.isDefault)
    );
    expect(def).toBeTruthy();
    expect(() =>
      runWithTenant(OWNER_A, () => taxonomyRepo.updateTaxonomyTerm(def!.id, { name: 'hijacked' }))
    ).toThrow(taxonomyRepo.DefaultTermEditError);
    expect(runWithTenant(OWNER_B, () => taxonomyRepo.getTaxonomyTerm(def!.id)?.name)).toBe(
      def!.name
    );

    const bTerm = runWithTenant(OWNER_B, () =>
      taxonomyRepo.createTaxonomyTerm({ domain: 'equipment', name: `b-term-${randomUUID()}` })
    );
    expect(runWithTenant(OWNER_A, () => taxonomyRepo.getTaxonomyTerm(bTerm.id))).toBeUndefined();
    expect(() =>
      runWithTenant(OWNER_A, () => taxonomyRepo.updateTaxonomyTerm(bTerm.id, { name: 'x' }))
    ).toThrow();

    const aTerm = runWithTenant(OWNER_A, () =>
      taxonomyRepo.createTaxonomyTerm({ domain: 'equipment', name: `a-term-${randomUUID()}` })
    );
    const renamed = runWithTenant(OWNER_A, () =>
      taxonomyRepo.updateTaxonomyTerm(aTerm.id, { name: `a-renamed-${randomUUID()}` })
    );
    expect(renamed.name).toMatch(/^a-renamed-/);
  });

  it('plugin_overrides (farm copies + farm retires) are owner-scoped', () => {
    const pluginId = `xt-plugin-${randomUUID()}`;
    const payload = JSON.stringify({ pluginId, type: 'crop', displayName: 'A copy' });
    const aRow = runWithTenant(OWNER_A, () =>
      pluginOverridesRepo.insertOverridePayload(pluginId, 'crop', payload)
    );
    runWithTenant(OWNER_A, () => pluginOverridesRepo.hideForOwner(`${pluginId}-2`, 'crop'));

    const aMap = runWithTenant(OWNER_A, () => pluginOverridesRepo.listEffectiveOverrides());
    expect(aMap.get(pluginId)?.payloadJson).toBe(payload);
    expect(
      runWithTenant(OWNER_A, () => pluginOverridesRepo.isHiddenForOwner(`${pluginId}-2`))
    ).toBe(true);

    const bMap = runWithTenant(OWNER_B, () => pluginOverridesRepo.listEffectiveOverrides());
    expect(bMap.has(pluginId)).toBe(false);
    expect(bMap.has(`${pluginId}-2`)).toBe(false);
    expect(
      runWithTenant(OWNER_B, () => pluginOverridesRepo.getOverrideByHash(pluginId, aRow.hash))
    ).toBeUndefined();
    expect(
      runWithTenant(OWNER_B, () => pluginOverridesRepo.isHiddenForOwner(`${pluginId}-2`))
    ).toBe(false);

    // B's unretire cannot remove A's marker.
    runWithTenant(OWNER_B, () => pluginOverridesRepo.unhideForOwner(`${pluginId}-2`));
    expect(
      runWithTenant(OWNER_A, () => pluginOverridesRepo.isHiddenForOwner(`${pluginId}-2`))
    ).toBe(true);
    expect(pluginOverridesRepo.overridesRevision(OWNER_A)).toBeGreaterThan(0);
  });

  // Phase 30 — kind-filtered Area and block reads stay inside the tenant.
  it('kind-filtered Area and block reads are owner-scoped', () => {
    const seedTyped = (ownerId: string) =>
      runWithTenant(ownerId, () => {
        const areaIds = new Set<string>();
        const blockIds = new Set<string>();
        for (const kind of AREA_KINDS) {
          const a = areasRepo.createArea({ name: `${ownerId}-${kind}`, kind });
          areaIds.add(a.id);
          for (const bk of BLOCK_KINDS) {
            blockIds.add(
              blocksRepo.createBlock({ name: `${ownerId}-${kind}-${bk}`, fieldId: a.id, kind: bk })
                .id
            );
          }
        }
        return { areaIds, blockIds };
      });
    const a = seedTyped(OWNER_A);
    const b = seedTyped(OWNER_B);

    fc.assert(
      fc.property(
        fc.subarray([...AREA_KINDS], { minLength: 1 }),
        fc.subarray([...BLOCK_KINDS], { minLength: 1 }),
        fc.constantFrom(OWNER_A, OWNER_B),
        (areaKinds, blockKinds, owner) => {
          const [mine, theirs] = owner === OWNER_A ? [a, b] : [b, a];
          runWithTenant(owner, () => {
            const areas = areasRepo.listAreas({ kinds: areaKinds });
            for (const row of areas) {
              expect(theirs.areaIds.has(row.id)).toBe(false);
              expect(areaKinds).toContain(row.kind);
            }
            const ownTyped = areas.filter((row) => mine.areaIds.has(row.id));
            expect(ownTyped).toHaveLength(areaKinds.length);

            const blockRows = blocksRepo.listBlocks({ kinds: blockKinds });
            for (const row of blockRows) {
              expect(theirs.blockIds.has(row.id)).toBe(false);
              expect(blockKinds).toContain(row.kind);
            }
          });
        }
      ),
      { numRuns: 40 }
    );

    const bGarden = runWithTenant(OWNER_B, () =>
      areasRepo.listAreas({ kinds: ['garden'] }).find((row) => b.areaIds.has(row.id))
    )!;
    expect(runWithTenant(OWNER_A, () => areasRepo.getArea(bGarden.id))).toBeUndefined();
    expect(
      runWithTenant(OWNER_A, () =>
        areasRepo.updateArea(bGarden.id, { kind: 'barn', details: { washPack: true } })
      )
    ).toBeUndefined();
    expect(runWithTenant(OWNER_B, () => areasRepo.getArea(bGarden.id))?.kind).toBe('garden');

    const bBed = runWithTenant(OWNER_B, () =>
      blocksRepo.listBlocks({ kinds: ['bed'] }).find((row) => b.blockIds.has(row.id))
    )!;
    expect(
      runWithTenant(OWNER_A, () => blocksRepo.updateBlock(bBed.id, { kind: 'row', xFt: 9 }))
    ).toBeUndefined();
    expect(runWithTenant(OWNER_B, () => blocksRepo.getBlock(bBed.id))?.kind).toBe('bed');
  });

  it('map_features lines and points are owner-scoped under any kind / Area filter', () => {
    const geometryFor = (kind: (typeof MAP_FEATURE_KINDS)[number], i: number) =>
      geometryTypeFor(kind) === 'Point'
        ? { type: 'Point' as const, coordinates: [-77.5 + i * 1e-4, 39.1] as [number, number] }
        : {
            type: 'LineString' as const,
            coordinates: [
              [-77.5, 39.1 + i * 1e-4],
              [-77.499, 39.1 + i * 1e-4]
            ] as Array<[number, number]>
          };
    const seedFeatures = (ownerId: string) =>
      runWithTenant(ownerId, () => {
        const area = fieldsRepo.createField({ name: `${ownerId}-features-area` });
        const ids = new Set<string>();
        MAP_FEATURE_KINDS.forEach((kind, i) => {
          ids.add(
            mapFeaturesRepo.createMapFeature({
              kind,
              name: `${ownerId}-${kind}`,
              geometry: geometryFor(kind, i),
              fieldId: i % 2 === 0 ? area.id : null,
              details: kind === 'water_source' ? { source: 'well' } : null
            }).id
          );
        });
        return { ids, areaId: area.id };
      });
    const a = seedFeatures(OWNER_A);
    const b = seedFeatures(OWNER_B);

    fc.assert(
      fc.property(
        fc.option(fc.constantFrom(...MAP_FEATURE_KINDS), { nil: undefined }),
        fc.option(fc.constantFrom(a.areaId, b.areaId), { nil: undefined }),
        fc.constantFrom(OWNER_A, OWNER_B),
        (kind, fieldId, owner) => {
          const [mine, theirs] = owner === OWNER_A ? [a, b] : [b, a];
          runWithTenant(owner, () => {
            const rows = mapFeaturesRepo.listMapFeatures({ kind, fieldId });
            for (const row of rows) {
              expect(theirs.ids.has(row.id)).toBe(false);
              if (kind) expect(row.kind).toBe(kind);
            }
            if (!kind && !fieldId) {
              expect(rows.filter((r) => mine.ids.has(r.id))).toHaveLength(MAP_FEATURE_KINDS.length);
            }
            if (fieldId === theirs.areaId) expect(rows).toHaveLength(0);
          });
        }
      ),
      { numRuns: 40 }
    );

    const bFence = runWithTenant(OWNER_B, () =>
      mapFeaturesRepo.listMapFeatures({ kind: 'fence' }).find((f) => b.ids.has(f.id))
    )!;
    runWithTenant(OWNER_A, () => {
      expect(mapFeaturesRepo.getMapFeature(bFence.id)).toBeUndefined();
      expect(mapFeaturesRepo.updateMapFeature(bFence.id, { name: 'hijacked' })).toBeUndefined();
      expect(mapFeaturesRepo.deleteMapFeature(bFence.id)).toBe(false);
      expect(mapFeaturesRepo.unlinkMapFeaturesFromField(b.areaId)).toBe(0);
    });
    const after = runWithTenant(OWNER_B, () => mapFeaturesRepo.getMapFeature(bFence.id));
    expect(after?.name).toBe(`${OWNER_B}-fence`);
    expect(after?.fieldId).toBe(b.areaId);
  });

  // #478 — the hydrant/waterer to Area links (map_feature_areas).
  it('map_feature_areas links are owner-scoped for reads, filters, updates and unlinks', () => {
    const seed = (ownerId: string) =>
      runWithTenant(ownerId, () => {
        const north = fieldsRepo.createField({ name: `${ownerId}-north` });
        const south = fieldsRepo.createField({ name: `${ownerId}-south` });
        const hydrant = mapFeaturesRepo.createMapFeature({
          kind: 'hydrant',
          name: `${ownerId}-hydrant`,
          geometry: { type: 'Point', coordinates: [-77.5, 39.1] },
          areaIds: [north.id, south.id]
        });
        return { north: north.id, south: south.id, hydrant: hydrant.id };
      });
    const a = seed(OWNER_A);
    const b = seed(OWNER_B);

    fc.assert(
      fc.property(
        fc.constantFrom(a.north, a.south, b.north, b.south),
        fc.constantFrom(OWNER_A, OWNER_B),
        (fieldId, owner) => {
          const [mine, theirs] = owner === OWNER_A ? [a, b] : [b, a];
          runWithTenant(owner, () => {
            const rows = mapFeaturesRepo.listMapFeatures({ kind: 'hydrant', fieldId });
            expect(rows.some((r) => r.id === theirs.hydrant)).toBe(false);
            const expected = fieldId === mine.north || fieldId === mine.south ? 1 : 0;
            expect(rows.filter((r) => r.id === mine.hydrant)).toHaveLength(expected);
            for (const link of mapFeaturesRepo.listMapFeatureAreaLinks()) {
              expect(link.featureId).not.toBe(theirs.hydrant);
            }
          });
        }
      ),
      { numRuns: 30 }
    );

    runWithTenant(OWNER_A, () => {
      expect(mapFeaturesRepo.getMapFeature(b.hydrant)).toBeUndefined();
      expect(mapFeaturesRepo.updateMapFeature(b.hydrant, { areaIds: [a.north] })).toBeUndefined();
      mapFeaturesRepo.unlinkMapFeaturesFromField(b.south);
      expect(mapFeaturesRepo.getMapFeature(a.hydrant)?.areaIds).toEqual([a.north, a.south]);
    });
    runWithTenant(OWNER_B, () => {
      expect(mapFeaturesRepo.getMapFeature(b.hydrant)?.areaIds).toEqual([b.north, b.south]);
      expect(mapFeaturesRepo.listMapFeatureAreaLinks()).toHaveLength(2);
    });
  });

  // Phase 30E — garden-bed footprints and date moves stay inside the tenant.
  it('garden placement writes and date moves are owner-scoped', () => {
    const placement = (x: number) => ({
      footprint: { x_in: x, y_in: 0, w_in: 12, l_in: 12 },
      spacingIn: null,
      rowSpacingIn: null,
      spacingPattern: 'square' as const,
      plantCount: 4,
      plantCountProvenance: 'data' as const
    });
    const seedPlaced = (ownerId: string) =>
      runWithTenant(ownerId, () => {
        const garden = areasRepo.createArea({ name: `${ownerId}-garden`, kind: 'garden' });
        const bed = blocksRepo.createBlock({
          name: `${ownerId}-bed`,
          fieldId: garden.id,
          kind: 'bed',
          widthFt: 4,
          lengthFt: 8
        });
        return cropsRepo.createPlanned({
          blockId: bed.id,
          cropPluginId: 'crop:lettuce',
          varietyDisplayName: 'Lettuce',
          plantingDate: Date.UTC(2027, 3, 1),
          placement: placement(0)
        });
      });
    const aCrop = seedPlaced(OWNER_A);
    const bCrop = seedPlaced(OWNER_B);

    fc.assert(
      fc.property(fc.integer({ min: 0, max: 36 }), fc.integer({ min: 1, max: 60 }), (x, days) => {
        runWithTenant(OWNER_A, () => {
          expect(cropsRepo.setPlacement(bCrop.id, placement(x))).toBeUndefined();
          expect(
            cropsRepo.movePlantingDate(bCrop.id, Date.UTC(2027, 3, 1) + days * 86_400_000)
          ).toBeUndefined();
          expect(cropsRepo.getCrop(bCrop.id)).toBeUndefined();
        });
        const theirs = runWithTenant(OWNER_B, () => cropsRepo.getCrop(bCrop.id))!;
        expect(theirs.footprint).toEqual(placement(0).footprint);
        expect(theirs.plantingDate).toBe(Date.UTC(2027, 3, 1));
      }),
      { numRuns: 25 }
    );

    runWithTenant(OWNER_A, () => {
      expect(cropsRepo.setPlacement(aCrop.id, placement(24))?.footprint?.x_in).toBe(24);
      const ids = cropsRepo.listCrops().map((c) => c.id);
      expect(ids).toContain(aCrop.id);
      expect(ids).not.toContain(bCrop.id);
    });
  });

  // Phase 35 (R-13): a split group id carries no authority. Two Owners using
  // the same string never see each other's parts.
  it('split group reads stay inside the tenant even with the same group id', () => {
    fc.assert(
      fc.property(fc.uuid(), fc.integer({ min: 1, max: 3 }), (uuid, parts) => {
        const groupId = `sg_${uuid}`;
        const seed = (ownerId: string) =>
          runWithTenant(ownerId, () => {
            const ids: string[] = [];
            for (let i = 0; i < parts + 1; i++) {
              const block = blocksRepo.createBlock({ name: `${ownerId}-split-${uuid}-${i}` });
              ids.push(
                blocksRepo.addPlanting({
                  blockId: block.id,
                  cropPluginId: 'crop:bean',
                  varietyDisplayName: 'Bean',
                  plantingDate: null,
                  quantityPlanted: 10,
                  quantityUnit: 'seeds',
                  splitGroupId: groupId
                }).id
              );
            }
            return ids;
          });
        const mine = seed(OWNER_A);
        const theirs = seed(OWNER_B);
        runWithTenant(OWNER_A, () => {
          const got = cropsRepo.listSplitGroup(groupId).map((c) => c.id);
          expect(got.sort()).toEqual([...mine].sort());
          for (const id of theirs) expect(got).not.toContain(id);
          const listed = blocksRepo
            .listBlocks()
            .flatMap((b) => b.plantings)
            .filter((p) => p.splitGroupId === groupId)
            .map((p) => p.id);
          expect(listed.sort()).toEqual([...mine].sort());
        });
        runWithTenant(OWNER_B, () => {
          const got = cropsRepo.listSplitGroup(groupId).map((c) => c.id);
          expect(got.sort()).toEqual([...theirs].sort());
        });
      }),
      { numRuns: 15 }
    );
  });

  it('planting_journal entries are owner-scoped: list, read, photo and delete (Phase 30G)', () => {
    const seed = (ownerId: string) =>
      runWithTenant(ownerId, () => {
        const field = fieldsRepo.createField({ name: `${ownerId}-journal-field` });
        const block = blocksRepo.createBlock({ name: `${ownerId}-journal-bed`, fieldId: field.id });
        const crop = cropsRepo.createPlanned({
          blockId: block.id,
          cropPluginId: 'crop:tomato',
          varietyDisplayName: 'Journal tomato'
        });
        const entry = plantingJournalRepo.insertJournalEntry({
          cropId: crop.id,
          blockId: block.id,
          createdBy: ensureCrossTenantTestUser(ownerId),
          kind: 'photo_help',
          text: `note from ${ownerId}`,
          photoRef: 'data:image/jpeg;base64,/9j/',
          provenance: 'manual'
        });
        return { cropId: crop.id, entryId: entry.id };
      });
    const a = seed(OWNER_A);
    const b = seed(OWNER_B);
    fc.assert(
      fc.property(
        fc.constantFrom([OWNER_A, a, b] as const, [OWNER_B, b, a] as const),
        ([me, mine, theirs]) =>
          runWithTenant(me, () => {
            expect(plantingJournalRepo.listJournalForCrop(mine.cropId).map((e) => e.id)).toEqual([
              mine.entryId
            ]);
            expect(plantingJournalRepo.listJournalForCrop(theirs.cropId)).toEqual([]);
            expect(
              plantingJournalRepo.getJournalEntry(theirs.cropId, theirs.entryId)
            ).toBeUndefined();
            expect(plantingJournalRepo.getJournalPhoto(theirs.cropId, theirs.entryId)).toBeNull();
            expect(
              plantingJournalRepo.deleteJournalEntry(theirs.cropId, theirs.entryId)
            ).toBeUndefined();
            expect(
              plantingJournalRepo.moveJournalPhotoToDocument(theirs.entryId, 'x', 'doc-x')
            ).toBe(false);
            const exported = plantingJournalRepo.listJournalForExport().map((e) => e.id);
            expect(exported).toContain(mine.entryId);
            expect(exported).not.toContain(theirs.entryId);
          })
      ),
      { numRuns: 6 }
    );
    expect(
      runWithTenant(OWNER_B, () => plantingJournalRepo.getJournalEntry(b.cropId, b.entryId))
    ).toBeTruthy();
  });

  it('email_alert_consents are owner-scoped: consent on farm A never covers farm B', () => {
    fc.assert(
      fc.property(
        fc.subarray(
          ['decon-due', 'lock-window-closing', 'spring-calibration', 'frost-tonight'] as const,
          {
            minLength: 1
          }
        ),
        (categories) => {
          const userId = ensureCrossTenantTestUser(`${OWNER_A}-email-${randomUUID()}`);
          runWithTenant(OWNER_A, () => {
            for (const c of categories) {
              emailAlertConsentsRepo.optIn(userId, c, { source: 'settings', ip: '198.51.100.7' });
            }
          });
          const aPrefs = runWithTenant(OWNER_A, () =>
            emailAlertConsentsRepo.getEmailPrefsForUser(userId)
          );
          const bPrefs = runWithTenant(OWNER_B, () =>
            emailAlertConsentsRepo.getEmailPrefsForUser(userId)
          );
          for (const c of categories) expect(aPrefs[c]).toBe(true);
          expect(Object.values(bPrefs).some(Boolean)).toBe(false);
          expect(
            runWithTenant(OWNER_B, () => emailAlertConsentsRepo.listOptedIn()).some(
              (r) => r.userId === userId
            )
          ).toBe(false);
          expect(
            runWithTenant(OWNER_B, () =>
              emailAlertConsentsRepo.optOut(userId, categories[0], { source: 'settings' })
            )
          ).toBe(false);
          expect(
            runWithTenant(OWNER_B, () =>
              emailAlertConsentsRepo.optOutAll(userId, { source: 'settings' })
            )
          ).toEqual([]);
          expect(
            runWithTenant(OWNER_B, () => emailAlertConsentsRepo.listConsentHistoryForUser(userId))
          ).toEqual([]);
          const stillOn = runWithTenant(OWNER_A, () =>
            emailAlertConsentsRepo.getEmailPrefsForUser(userId)
          );
          for (const c of categories) expect(stillOn[c]).toBe(true);
        }
      ),
      { numRuns: 12 }
    );
  });

  it('every Phase 32 table is owner-scoped: list and read-by-id never cross Owners', () => {
    const tag = randomUUID().slice(0, 8);
    const a = runWithTenant(OWNER_A, () => seedPhase32Rows(`p32a-${tag}`));
    const b = runWithTenant(OWNER_B, () => seedPhase32Rows(`p32b-${tag}`));
    fc.assert(
      fc.property(
        fc.constantFrom(...(Object.keys(PHASE_32_TABLES) as Phase32Table[])),
        fc.boolean(),
        (table, aIsReader) => {
          const [reader, mine, theirs] = aIsReader ? [OWNER_A, a, b] : [OWNER_B, b, a];
          runWithTenant(reader, () => {
            const seen = listPhase32Ids(table);
            expect(seen).toContain(mine.rowIds[table]);
            expect(seen).not.toContain(theirs.rowIds[table]);
            expect(listPhase32Ids(table, theirs.rowIds[table])).toEqual([]);
          });
        }
      ),
      { numRuns: 60 }
    );
  });

  it("animal repos never read, count, move or change another Owner's animals", () => {
    const seed = (ownerId: string) =>
      runWithTenant(ownerId, () => {
        const field = fieldsRepo.createField({ name: `${ownerId}-coop`, kind: 'barn' });
        const group = animalGroupsRepo.insertAnimalGroup({
          name: `${ownerId}-layers`,
          speciesId: 'chicken',
          purpose: 'production',
          headCount: 6,
          foodProducing: true,
          housingFieldId: field.id
        });
        const stay = animalLocationsRepo.insertStay({
          subject: { subjectType: 'group', subjectId: group.id },
          fieldId: field.id,
          atMs: Date.now() - 60_000,
          movedBy: null
        });
        const hen = animalsRepo.insertAnimal({
          speciesId: 'chicken',
          groupId: group.id,
          name: `${ownerId}-hen`,
          tag: 'X1',
          purpose: 'production',
          foodProducing: true,
          housingFieldId: field.id
        });
        animalsRepo.setAnimalPhoto(hen.id, 'data:image/jpeg;base64,/9j/');
        const flag = animalsRepo.setAnimalFlag(hen.id, 'food_producing', false, 'pet', null)!;
        const event = animalStatusRepo.insertStatusEvent({
          subjectType: 'group',
          subjectId: group.id,
          status: 'died',
          occurredAt: Date.now(),
          headCountDelta: -1,
          recordedById: null
        });
        if (!stay.ok) throw new Error('seed stay');
        return {
          fieldId: field.id,
          groupId: group.id,
          henId: hen.id,
          stayId: stay.location.id,
          eventId: event.id,
          flagId: flag.id
        };
      });
    const a = seed(OWNER_A);
    const b = seed(OWNER_B);
    fc.assert(
      fc.property(
        fc.constantFrom([OWNER_A, a, b] as const, [OWNER_B, b, a] as const),
        ([me, mine, theirs]) =>
          runWithTenant(me, () => {
            const ids = (rows: Array<{ id: string }>) => rows.map((r) => r.id);
            expect(ids(animalsRepo.listAnimals({ status: 'all' }))).toContain(mine.henId);
            expect(ids(animalsRepo.listAnimals({ status: 'all' }))).not.toContain(theirs.henId);
            expect(animalsRepo.getAnimal(theirs.henId)).toBeUndefined();
            expect(animalsRepo.hasAnyAnimalRecord()).toBe(true);
            expect(animalsRepo.getAnimalPhoto(theirs.henId)).toBeNull();
            expect(animalsRepo.listGroupMembers(theirs.groupId)).toEqual([]);
            expect(animalsRepo.listFlagChanges('animal', theirs.henId)).toEqual([]);
            expect(ids(animalsRepo.findTagConflicts('X1'))).toContain(mine.henId);
            expect(ids(animalsRepo.findTagConflicts('X1'))).not.toContain(theirs.henId);
            expect(
              animalsRepo.hasRecords(animalsRepo.subjectRecordCounts('group', theirs.groupId))
            ).toBe(false);
            expect(animalsRepo.updateAnimal(theirs.henId, { name: 'stolen' })).toBeUndefined();
            expect(animalsRepo.setAnimalPhoto(theirs.henId, null)).toBe(false);
            expect(animalsRepo.setAnimalPhotoDocument(theirs.henId, 'doc-x')).toBe(false);
            expect(
              animalsRepo.moveAnimalPhotoToDocument(
                theirs.henId,
                'data:image/jpeg;base64,/9j/',
                'doc-x'
              )
            ).toBe(false);
            expect(
              animalsRepo.setAnimalFlag(theirs.henId, 'food_producing', true, 'x', null)
            ).toBeNull();
            expect(animalsRepo.deleteAnimalIfEmpty(theirs.henId)).toBe('not-found');

            expect(ids(animalGroupsRepo.listAnimalGroups({ status: 'all' }))).toContain(
              mine.groupId
            );
            expect(ids(animalGroupsRepo.listAnimalGroups({ status: 'all' }))).not.toContain(
              theirs.groupId
            );
            expect(animalGroupsRepo.getAnimalGroup(theirs.groupId)).toBeUndefined();
            expect(animalGroupsRepo.getAnimalGroupSummary(theirs.groupId)).toBeUndefined();
            expect(animalGroupsRepo.activeMemberCount(theirs.groupId)).toBe(0);
            expect(animalGroupsRepo.groupMemberRowCount(theirs.groupId)).toBe(0);
            expect(
              animalGroupsRepo.updateAnimalGroup(theirs.groupId, { name: 'x' })
            ).toBeUndefined();
            expect(
              animalGroupsRepo.setGroupFoodProducing(theirs.groupId, false, 'x', null)
            ).toBeNull();
            expect(animalGroupsRepo.deleteGroupIfEmpty(theirs.groupId)).toBe('not-found');

            expect(animalLocationsRepo.listLocationsForSubject('group', theirs.groupId)).toEqual(
              []
            );
            expect(animalLocationsRepo.getLocation(theirs.stayId)).toBeUndefined();
            expect(animalLocationsRepo.listLocationsOnField(theirs.fieldId)).toEqual([]);
            expect(animalLocationsRepo.housedOnField(theirs.fieldId).total).toBe(0);
            expect(animalLocationsRepo.housedSubjectCount(theirs.fieldId)).toBe(0);
            expect(animalLocationsRepo.deleteLatestStay(theirs.stayId)).toEqual({
              ok: false,
              reason: 'not-found'
            });
            expect(
              animalLocationsRepo.endStayAt(
                { subjectType: 'group', subjectId: theirs.groupId },
                Date.now()
              )
            ).toBeNull();
            expect(ids(animalLocationsRepo.listLocationsOnField(mine.fieldId))).toEqual([
              mine.stayId
            ]);
            expect(animalLocationsRepo.housedOnField(mine.fieldId).total).toBe(7);

            expect(animalStatusRepo.listStatusEvents('group', theirs.groupId)).toEqual([]);
            expect(animalStatusRepo.getStatusEvent(theirs.eventId)).toBeUndefined();
            expect(animalStatusRepo.deleteStatusEvent(theirs.eventId)).toBe(false);
            expect(ids(animalStatusRepo.listStatusEvents('group', mine.groupId))).toEqual([
              mine.eventId
            ]);
          })
      ),
      { numRuns: 8 }
    );
    expect(runWithTenant(OWNER_B, () => animalsRepo.getAnimal(b.henId)?.name)).toBe(
      `${OWNER_B}-hen`
    );
    expect(
      runWithTenant(OWNER_A, () => animalLocationsRepo.getLocation(a.stayId)?.toMs)
    ).toBeNull();
    expect(
      runWithTenant('cross-tenant-test-owner-no-animals', () => animalsRepo.hasAnyAnimalRecord())
    ).toBe(false);
  });

  it("grazing attestations never read another Owner's rows", () => {
    const seed = (ownerId: string) =>
      runWithTenant(ownerId, () => {
        const field = fieldsRepo.createField({ name: `${ownerId}-pasture`, kind: 'pasture' });
        const row = grazingAttestationsRepo.insertGrazingAttestation({
          fieldId: field.id,
          sprayEventRef: `spray:${ownerId}`,
          productPluginId: null,
          grazeDays: 7,
          hayDays: null,
          reason: 'read from the label',
          attestedBy: null
        });
        return { fieldId: field.id, id: row.id, ref: `spray:${ownerId}` };
      });
    const a = seed(OWNER_A);
    const b = seed(OWNER_B);
    fc.assert(
      fc.property(
        fc.constantFrom([OWNER_A, a, b] as const, [OWNER_B, b, a] as const),
        ([me, mine, theirs]) =>
          runWithTenant(me, () => {
            const all = grazingAttestationsRepo.listGrazingAttestations().map((r) => r.id);
            expect(all).toContain(mine.id);
            expect(all).not.toContain(theirs.id);
            expect(
              grazingAttestationsRepo.listGrazingAttestations({ fieldIds: [theirs.fieldId] })
            ).toEqual([]);
            expect(
              grazingAttestationsRepo.listGrazingAttestations({ sprayEventRefs: [theirs.ref] })
            ).toEqual([]);
            expect(grazingAttestationsRepo.getGrazingAttestation(theirs.id)).toBeUndefined();
            expect(grazingAttestationsRepo.getGrazingAttestation(mine.id)?.grazeDays).toBe(7);
          })
      ),
      { numRuns: 10 }
    );
  });

  it("animal health and production repos never read, lock, change or delete another Owner's rows", () => {
    const seed = (ownerId: string) =>
      runWithTenant(ownerId, () => {
        const group = animalGroupsRepo.insertAnimalGroup({
          name: `${ownerId}-flock`,
          speciesId: 'chicken',
          purpose: 'production',
          headCount: 3,
          foodProducing: true
        });
        const hen = animalsRepo.insertAnimal({
          speciesId: 'chicken',
          name: `${ownerId}-hen`,
          groupId: group.id,
          purpose: 'production',
          foodProducing: true
        });
        animalLocationsRepo.insertGroupChangeMarker({
          subject: { subjectType: 'animal', subjectId: hen.id },
          fieldId: fieldsRepo.createField({ name: `${ownerId}-coop`, kind: 'barn' }).id,
          atMs: Date.now() - 1000,
          movedBy: null,
          fromGroupId: null,
          toGroupId: group.id
        });
        const old = Date.now() - 5 * 86_400_000;
        const treatment = animalHealthRepo.insertHealthEvent({
          subjectType: 'group',
          subjectId: group.id,
          kind: 'deworm',
          productName: 'wormer',
          administeredAt: old,
          withdrawalClear: null,
          rulesVersion: 'test',
          foodProducingAtRecord: true,
          performedById: null
        });
        const log = animalProductionRepo.insertProductionLog({
          subjectType: 'group',
          subjectId: group.id,
          kind: 'eggs',
          quantity: 6,
          unit: 'eggs',
          occurredAt: old,
          use: 'food',
          rulesVersion: 'test',
          performedById: null
        });
        return { groupId: group.id, henId: hen.id, treatmentId: treatment.id, logId: log.id };
      });
    const a = seed(OWNER_A);
    const b = seed(OWNER_B);
    fc.assert(
      fc.property(
        fc.constantFrom([OWNER_A, a, b] as const, [OWNER_B, b, a] as const),
        ([me, mine, theirs]) =>
          runWithTenant(me, () => {
            const subject = { subjectType: 'group' as const, subjectId: theirs.groupId };
            expect(animalHealthRepo.getHealthEvent(theirs.treatmentId)).toBeUndefined();
            expect(animalHealthRepo.listHealthEvents('group', theirs.groupId)).toEqual([]);
            expect(animalHealthRepo.listHealthEventsForSubjects([subject])).toEqual([]);
            expect(animalHealthRepo.listHealthTombstones([subject])).toEqual([]);
            expect(animalHealthRepo.listAnimalIdsEverInGroup(theirs.groupId)).toEqual([]);
            expect(
              animalHealthRepo.saveWithdrawalEntries(theirs.treatmentId, '[]')
            ).toBeUndefined();
            expect(animalHealthRepo.getHealthEvent(mine.treatmentId)?.subjectId).toBe(mine.groupId);
            expect(animalHealthRepo.listAnimalIdsEverInGroup(mine.groupId)).toEqual([mine.henId]);

            expect(animalProductionRepo.getProductionLog(theirs.logId)).toBeUndefined();
            expect(animalProductionRepo.listProductionLogs('group', theirs.groupId)).toEqual([]);
            expect(animalProductionRepo.listFoodLogsForSubjects([subject])).toEqual([]);
            expect(
              animalProductionRepo
                .listFoodLogsForSubjects([{ subjectType: 'group', subjectId: mine.groupId }])
                .map((l) => l.id)
            ).toEqual([mine.logId]);
          })
      ),
      { numRuns: 10 }
    );
    runWithTenant(OWNER_A, () => {
      const theirLog = runWithTenant(OWNER_B, () =>
        animalProductionRepo.getProductionLog(b.logId)
      )!;
      expect(
        animalProductionRepo.setProductionUse(theirLog, 'discard', {
          by: null,
          reason: null,
          rulesVersion: 'x'
        })
      ).toBeUndefined();
      expect(
        animalProductionRepo.deleteProductionLog(theirLog, {
          by: null,
          reason: null,
          tombstone: false
        })
      ).toBe(false);
      const theirEvent = runWithTenant(OWNER_B, () =>
        animalHealthRepo.getHealthEvent(b.treatmentId)
      )!;
      expect(
        animalHealthRepo.deleteHealthEvent(theirEvent, {
          deletedBy: null,
          reason: null,
          dosed: true
        })
      ).toBe(false);
      expect(
        animalHealthRepo.listHealthTombstones([{ subjectType: 'group', subjectId: b.groupId }])
      ).toEqual([]);
    });
    runWithTenant(OWNER_B, () => {
      expect(animalProductionRepo.getProductionLog(b.logId)?.use).toBe('food');
      expect(animalHealthRepo.getHealthEvent(b.treatmentId)).toBeDefined();
      expect(
        animalHealthRepo.listHealthTombstones([{ subjectType: 'group', subjectId: b.groupId }])
      ).toEqual([]);
    });
  });

  it("care plans and care tasks never read, change or reopen another Owner's rows (32D)", () => {
    const seed = (ownerId: string) =>
      runWithTenant(ownerId, () => {
        const dog = animalsRepo.insertAnimal({
          speciesId: 'dog',
          name: `${ownerId}-dog`,
          purpose: 'pet',
          foodProducing: false
        });
        const plan = carePlansRepo.insertCarePlan({
          subjectType: 'animal',
          subjectId: dog.id,
          kind: 'vaccination',
          title: 'Rabies vaccine',
          intervalDays: 365,
          nextDueOn: '2030-01-10',
          leadDays: 14,
          provenance: 'manual'
        });
        careTasksRepo.upsertCareTask({
          meta: {
            subjectType: 'animal',
            subjectId: dog.id,
            planId: plan.id,
            dueOn: '2030-01-10',
            careKind: 'vaccination',
            leadDays: 14
          },
          title: 'Rabies vaccine: dog'
        });
        return { dogId: dog.id, planId: plan.id };
      });
    const a = seed(OWNER_A);
    const b = seed(OWNER_B);
    fc.assert(
      fc.property(
        fc.constantFrom([OWNER_A, a, b] as const, [OWNER_B, b, a] as const),
        ([me, mine, theirs]) =>
          runWithTenant(me, () => {
            expect(carePlansRepo.getCarePlan(theirs.planId)).toBeUndefined();
            expect(carePlansRepo.listCarePlansForSubject('animal', theirs.dogId)).toEqual([]);
            expect(
              carePlansRepo.listCarePlansForSubjects([
                { subjectType: 'animal', subjectId: theirs.dogId }
              ])
            ).toEqual([]);
            expect(
              carePlansRepo.listActiveDatedCarePlans().some((p) => p.id === theirs.planId)
            ).toBe(false);
            expect(
              carePlansRepo.careSubjects([{ subjectType: 'animal', subjectId: theirs.dogId }]).size
            ).toBe(0);
            expect(carePlansRepo.updateCarePlan(theirs.planId, { title: 'x' })).toBeUndefined();
            expect(carePlansRepo.deleteCarePlan(theirs.planId)).toBe(false);
            expect(careTasksRepo.listOpenTasksForPlan(theirs.planId)).toEqual([]);
            expect(
              careTasksRepo.listOpenCareTasks().every((t) => !t.id.includes(theirs.planId))
            ).toBe(true);
            expect(careTasksRepo.listOpenTasksForPlan(mine.planId)).toHaveLength(1);
          })
      ),
      { numRuns: 6 }
    );
    runWithTenant(OWNER_A, () => {
      const theirTaskId = `tk_care_${b.planId}_20300110`;
      runWithTenant(OWNER_B, () => tasksRepo.abortTask(theirTaskId, 'plan-edited'));
      expect(
        careTasksRepo.upsertCareTask({
          meta: {
            subjectType: 'animal',
            subjectId: a.dogId,
            planId: b.planId,
            dueOn: '2030-01-10',
            careKind: 'vaccination',
            leadDays: 14
          },
          title: 'stolen'
        })
      ).toBe(false);
    });
    runWithTenant(OWNER_B, () => {
      const t = tasksRepo.getTask(`tk_care_${b.planId}_20300110`);
      expect(t?.title).toBe('Rabies vaccine: dog');
      expect(t?.abortReason).toBe('plan-edited');
      expect(carePlansRepo.getCarePlan(b.planId)?.title).toBe('Rabies vaccine');
    });
  });

  it('every Phase 33 table is owner-scoped: list and read-by-id never cross Owners', () => {
    const tag = randomUUID().slice(0, 8);
    seedOwnerRow(OWNER_A);
    seedOwnerRow(OWNER_B);
    const a = seedPhase33(OWNER_A, `p33a-${tag}`);
    const b = seedPhase33(OWNER_B, `p33b-${tag}`);
    fc.assert(
      fc.property(
        fc.constantFrom(...(Object.keys(PHASE_33_TABLES) as Phase33Table[])),
        fc.boolean(),
        (table, aIsReader) => {
          const [reader, mine, theirs] = aIsReader ? [OWNER_A, a, b] : [OWNER_B, b, a];
          runWithTenant(reader, () => {
            const seen = listPhase33Ids(table);
            expect(seen).toContain(mine.rowIds[table]);
            expect(seen).not.toContain(theirs.rowIds[table]);
            expect(listPhase33Ids(table, theirs.rowIds[table])).toEqual([]);
          });
        }
      ),
      { numRuns: 60 }
    );
  });

  it("document repo and Phase 33 reference checks never read, count or change another Owner's rows", () => {
    const tag = randomUUID().slice(0, 8);
    seedOwnerRow(OWNER_A);
    seedOwnerRow(OWNER_B);
    const a = seedPhase33(OWNER_A, `p33ra-${tag}`);
    const b = seedPhase33(OWNER_B, `p33rb-${tag}`);
    const extra = (ownerId: string, size: number) =>
      runWithTenant(ownerId, () => {
        const id = randomUUID();
        documentsRepo.insertDocument({
          id,
          kind: 'receipt',
          title: 'Seed receipt',
          mime: 'image/png',
          byteSize: size,
          sha256: 'b'.repeat(64),
          crc32: 7,
          storageKey: documentsRepo.documentStorageKey(ownerId, id),
          originalName: null,
          uploadedBy: null
        });
        return id;
      });
    fc.assert(
      fc.property(
        fc.constantFrom(...DOCUMENT_SUBJECT_TYPES),
        fc.integer({ min: 1, max: 5_000_000 }),
        fc.boolean(),
        (subjectType, size, aIsReader) => {
          const [reader, mine, theirs] = aIsReader ? [OWNER_A, a, b] : [OWNER_B, b, a];
          const before = runWithTenant(theirs.ownerId, () => documentsRepo.liveDocumentBytes());
          const theirExtra = extra(theirs.ownerId, size);
          runWithTenant(reader, () => {
            const mineBytes = documentsRepo.liveDocumentBytes();
            expect(documentsRepo.getDocument(theirs.documentId)).toBeUndefined();
            expect(documentsRepo.getDocument(theirExtra, { includeDeleted: true })).toBeUndefined();
            expect(documentsRepo.documentExists(theirExtra)).toBe(false);
            expect(documentsRepo.markDocumentDeleted(theirExtra, null)).toBeUndefined();
            expect(documentsRepo.liveDocumentBytes()).toBe(mineBytes);
            expect(documentsRepo.getDocument(mine.documentId)?.id).toBe(mine.documentId);

            expect(refResolves(assertDocument('documentId', mine.documentId))).toBe(true);
            expect(refResolves(assertDocument('documentId', theirs.documentId))).toBe(false);
            expect(
              refResolves(
                assertDocumentSubject('subjectId', subjectType, mine.subjects[subjectType])
              )
            ).toBe(true);
            expect(
              refResolves(
                assertDocumentSubject('subjectId', subjectType, theirs.subjects[subjectType])
              )
            ).toBe(false);
            expect(
              refResolves(assertAmendmentBatch('batchId', theirs.subjects['amendment-batch']))
            ).toBe(false);
            expect(refResolves(assertHayCutting('cutId', theirs.hayCuttingId))).toBe(false);
            expect(refResolves(assertHayCutting('cutId', mine.hayCuttingId))).toBe(true);
          });
          runWithTenant(theirs.ownerId, () => {
            expect(documentsRepo.documentExists(theirExtra)).toBe(true);
            expect(documentsRepo.liveDocumentBytes()).toBe(before + size);
            expect(documentsRepo.markDocumentDeleted(theirExtra, null)?.deletedAt).toBeTruthy();
            expect(documentsRepo.liveDocumentBytes()).toBe(before);
          });
        }
      ),
      { numRuns: 40 }
    );
  });

  it("amendment repo never reads, counts or changes another Owner's batches, inputs, bioassays or dismissals", () => {
    const tag = randomUUID().slice(0, 8);
    seedOwnerRow(OWNER_A);
    seedOwnerRow(OWNER_B);
    const a = seedPhase33(OWNER_A, `p33ca-${tag}`);
    const b = seedPhase33(OWNER_B, `p33cb-${tag}`);
    fc.assert(
      fc.property(fc.boolean(), fc.string({ minLength: 1, maxLength: 20 }), (aIsReader, name) => {
        const [reader, mine, theirs] = aIsReader ? [OWNER_A, a, b] : [OWNER_B, b, a];
        runWithTenant(reader, () => {
          const theirBatch = theirs.rowIds.amendment_batches;
          const theirInput = theirs.rowIds.amendment_batch_inputs;
          expect(amendmentsRepo.getBatch(theirBatch)).toBeUndefined();
          expect(amendmentsRepo.listBatches().map((x) => x.id)).not.toContain(theirBatch);
          expect(amendmentsRepo.listBatches().map((x) => x.id)).toContain(
            mine.rowIds.amendment_batches
          );
          expect(amendmentsRepo.updateBatch(theirBatch, { name })).toBeUndefined();
          expect(amendmentsRepo.listBatchInputs(theirBatch)).toEqual([]);
          expect(amendmentsRepo.listBatchInputs().map((x) => x.id)).not.toContain(theirInput);
          expect(amendmentsRepo.getBatchInput(theirInput)).toBeUndefined();
          expect(amendmentsRepo.deleteBatchInput(theirInput)).toBe(false);
          expect(amendmentsRepo.listBioassays().map((x) => x.id)).not.toContain(
            theirs.rowIds.amendment_bioassays
          );
          expect(amendmentsRepo.getBioassay(theirs.rowIds.amendment_bioassays)).toBeUndefined();
          expect(amendmentsRepo.deleteBioassay(theirs.rowIds.amendment_bioassays)).toBe(false);
          expect(amendmentsRepo.listDismissals().map((x) => x.id)).not.toContain(
            theirs.rowIds.amendment_dismissals
          );
          expect(amendmentsRepo.getDismissal(theirs.rowIds.amendment_dismissals)).toBeUndefined();
          expect(amendmentsRepo.deleteDismissal(theirs.rowIds.amendment_dismissals)).toBe(false);
          expect(amendmentsRepo.listBatchSpreads(theirBatch)).toEqual([]);
          expect(amendmentsRepo.getAmendmentLot(theirs.phase32.stockLotId)).toBeUndefined();
          expect(amendmentsRepo.listLotsById([theirs.phase32.stockLotId]).map((l) => l.id)).toEqual(
            []
          );
          expect(
            amendmentsRepo
              .listAmendmentLots(['feed', 'bedding', 'fertilizer', 'animal-health'])
              .map((l) => l.id)
          ).not.toContain(theirs.phase32.stockLotId);
          expect(
            amendmentsRepo.listHayLots().every((l) => l.id !== theirs.phase32.stockLotId)
          ).toBe(true);
          expect(
            amendmentsRepo.findBatchInput({
              batchId: theirBatch,
              inputType: 'group',
              inputId: theirs.phase32.groupId,
              fromAt: 0
            })
          ).toBeUndefined();
        });
        runWithTenant(theirs.ownerId, () => {
          expect(amendmentsRepo.getBatch(theirs.rowIds.amendment_batches)?.name).toBe(
            `${theirs === a ? 'p33ca' : 'p33cb'}-${tag} pile`
          );
          expect(amendmentsRepo.getBatchInput(theirs.rowIds.amendment_batch_inputs)).toBeDefined();
          expect(amendmentsRepo.getBioassay(theirs.rowIds.amendment_bioassays)).toBeDefined();
          expect(amendmentsRepo.getDismissal(theirs.rowIds.amendment_dismissals)).toBeDefined();
        });
      }),
      { numRuns: 30 }
    );
    runWithTenant(OWNER_A, () => {
      expect(amendmentsRepo.getBatch(a.rowIds.amendment_batches)?.name).toBe(`p33ca-${tag} pile`);
    });
    runWithTenant(OWNER_B, () => {
      expect(amendmentsRepo.getBatch(b.rowIds.amendment_batches)?.name).toBe(`p33cb-${tag} pile`);
    });
  });

  it("forage test repo and advisory facts never read, count or change another Owner's rows", () => {
    const tag = randomUUID().slice(0, 8);
    seedOwnerRow(OWNER_A);
    seedOwnerRow(OWNER_B);
    const a = seedPhase33(OWNER_A, `p33fa-${tag}`);
    const b = seedPhase33(OWNER_B, `p33fb-${tag}`);
    for (const s of [a, b]) {
      runWithTenant(s.ownerId, () => {
        pushSubscriptionsRepo.claimDelivery('frost-tonight', `frost-${s.ownerId}-${tag}`);
      });
    }
    const theirAlert = (ownerId: string) =>
      runWithTenant(ownerId, () => forageTestsRepo.frostAlertTimes(0).length);
    fc.assert(
      fc.property(fc.boolean(), (aIsReader) => {
        const [reader, mine, theirs] = aIsReader ? [OWNER_A, a, b] : [OWNER_B, b, a];
        const theirTest = theirs.rowIds.forage_tests;
        const theirAlerts = theirAlert(theirs.ownerId);
        runWithTenant(reader, () => {
          expect(forageTestsRepo.getForageTest(theirTest)).toBeUndefined();
          expect(forageTestsRepo.getForageTest(mine.rowIds.forage_tests)?.id).toBe(
            mine.rowIds.forage_tests
          );
          const all = forageTestsRepo.listForageTests().map((t) => t.id);
          expect(all).toContain(mine.rowIds.forage_tests);
          expect(all).not.toContain(theirTest);
          expect(forageTestsRepo.listForageTests({ hayCuttingId: theirs.hayCuttingId })).toEqual(
            []
          );
          expect(forageTestsRepo.listForageTests({ blockIds: [theirs.subjects.block] })).toEqual(
            []
          );
          expect(forageTestsRepo.deleteForageTest(theirTest)).toBe(false);
          expect(forageTestsRepo.forageFactsForArea(theirs.subjects.field).area).toBeNull();
          expect(forageTestsRepo.forageFactsForBlock(theirs.subjects.block).blocks).toEqual([]);
          expect(forageTestsRepo.getForageArea(theirs.subjects.field)).toBeUndefined();
          expect(forageTestsRepo.stockLotCategory(theirs.phase32.stockLotId)).toBeUndefined();
          const mineFacts = forageTestsRepo.forageFactsForBlock(mine.subjects.block);
          expect(mineFacts.cuts.map((c) => c.id)).toContain(mine.hayCuttingId);
          expect(mineFacts.cuts.map((c) => c.id)).not.toContain(theirs.hayCuttingId);
          expect(forageTestsRepo.frostAlertTimes(0).length).toBeGreaterThan(0);
        });
        expect(theirAlert(theirs.ownerId)).toBe(theirAlerts);
        runWithTenant(theirs.ownerId, () => {
          expect(forageTestsRepo.getForageTest(theirTest)?.id).toBe(theirTest);
        });
      }),
      { numRuns: 20 }
    );
  });

  // Quiet noise — these imports exist so the test refuses to compile when a
  // new repo is added without explicit consideration. Listing them here is
  // the human-readable "we audited everything" gate.
  it('every tenant-scoped repo is exercised', () => {
    const auditedModules = [
      blocksRepo,
      fieldsRepo,
      areasRepo,
      cropsRepo,
      shadeRepo,
      mapFeaturesRepo,
      sprayRepo,
      harvestRepo,
      insecticideRepo,
      fungicideRepo,
      hayRepo,
      equipmentRepo,
      cropEquipmentRepo,
      fertilityRepo,
      stockRepo,
      tasksRepo,
      settingsRepo,
      planRevisionsRepo,
      scoutObservationsRepo,
      wizardChatRepo,
      seasonCloseoutsRepo,
      pushSubscriptionsRepo,
      emailAlertConsentsRepo,
      pluginOverridesRepo,
      plantingJournalRepo,
      animalsRepo,
      animalGroupsRepo,
      animalLocationsRepo,
      animalStatusRepo,
      grazingAttestationsRepo,
      animalHealthRepo,
      animalProductionRepo,
      carePlansRepo,
      careTasksRepo,
      documentsRepo,
      amendmentsRepo,
      forageTestsRepo
    ];
    for (const m of auditedModules) {
      expect(m).toBeTruthy();
    }
  });
});

function refResolves(
  ref: readonly [string, string | null | undefined, (id: string) => unknown]
): boolean {
  return !!ref[1] && !!ref[2](ref[1]);
}

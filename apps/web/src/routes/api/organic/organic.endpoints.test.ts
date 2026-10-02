// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/server/auth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('$lib/server/auth')>()),
  ...(await import('$lib/server/documents.testkit')).authOverrides()
}));

import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { db } from '$lib/db/client';
import { organicTreatmentReviews } from '$lib/db/schema';
import { runWithTenant, withTenant } from '$lib/db/tenant';
import { createField } from '$lib/db/fields';
import { insertAnimal } from '$lib/db/animals';
import { insertAnimalGroup } from '$lib/db/animalGroups';
import { deleteHealthEvent, getHealthEvent, insertHealthEvent } from '$lib/db/animalHealth';
import { insertDocument, documentStorageKey } from '$lib/db/documents';
import { upsertReview } from '$lib/db/organicReviews';
import { closeSeason } from '$lib/server/seasonClose';
import { actAs, call, seedFarm, type TestFarm } from '$lib/server/documents.testkit';
import {
  animalOrganicStatusAt,
  blockOrganicStatusAt,
  farmOrganicChrome,
  listOrganicStatusHistory
} from '$lib/organic/status.server';
import { organicTreatmentOutcomes } from '$lib/organic/animalStatus.server';
import { isUnderOrganic } from '$lib/organic/status';
import { RULES_VERSION } from '$lib/safety/version';
import { buildFarmSnapshot } from '$lib/server/cardSnapshot';
import { runWithTenantAsync } from '$lib/db/tenant';
import { GET as statusGet, POST as statusPost } from './status/+server';
import { POST as reviewPost } from './treatment-reviews/+server';

const DAY = 86_400_000;
let farm: TestFarm;

beforeEach(() => {
  farm = seedFarm();
  actAs(farm, 'owner');
});

const inFarm = <T>(f: TestFarm, fn: () => T): T => runWithTenant(f.ownerId, fn);

function ymd(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

function postStatus(json: Record<string, unknown>) {
  return call(statusPost, { method: 'POST', path: '/api/organic/status', json });
}

function hen(f: TestFarm, opts: { groupId?: string } = {}) {
  return inFarm(f, () =>
    insertAnimal({
      speciesId: 'chicken',
      name: `Hen ${randomUUID().slice(0, 4)}`,
      purpose: 'production',
      foodProducing: true,
      groupId: opts.groupId ?? null
    })
  );
}

function dewormer(f: TestFarm, subjectType: 'animal' | 'group', subjectId: string, at: number) {
  return inFarm(f, () =>
    insertHealthEvent({
      subjectType,
      subjectId,
      kind: 'deworm',
      productName: 'Pour-on dewormer',
      administeredAt: at,
      withdrawalClear: null,
      rulesVersion: RULES_VERSION,
      foodProducingAtRecord: true,
      performedById: f.ownerUser
    })
  );
}

describe('POST /api/organic/status (B-07, B-08, B-12)', () => {
  it('saves an owner entry and the block inherits it from its Area', async () => {
    const res = await postStatus({
      subjectType: 'field',
      subjectId: farm.fieldId,
      status: 'transitioning',
      effectiveOn: '2025-04-01',
      certifier: 'OCIA'
    });
    expect(res.status).toBe(201);
    const { entry } = (await res.json()) as { entry: { id: string; effectiveAt: number } };
    const s = inFarm(farm, () => blockOrganicStatusAt(farm.blockId, Date.now()));
    expect(s?.status).toBe('transitioning');
    expect(s?.inheritedFrom?.subjectId).toBe(farm.fieldId);
    expect(s?.entryId).toBe(entry.id);
    expect(new Date(entry.effectiveAt).toISOString()).toBe('2025-04-01T04:00:00.000Z');
    const listed = (await (await call(statusGet, { path: '/api/organic/status' })).json()) as {
      entries: unknown[];
    };
    expect(listed.entries).toHaveLength(1);
  });

  it('refuses helpers, inspectors and impersonation, and lets them read', async () => {
    for (const role of ['helper', 'inspector'] as const) {
      actAs(farm, role);
      const res = await postStatus({
        subjectType: 'block',
        subjectId: farm.blockId,
        status: 'organic',
        effectiveOn: '2025-01-01'
      });
      expect(res.status).toBe(403);
      expect(((await res.json()) as { error: string }).error).toBe('OWNER_ONLY');
      expect((await call(statusGet, { path: '/api/organic/status' })).status).toBe(200);
    }
    actAs(farm, 'owner', { impersonating: true });
    const imp = await postStatus({
      subjectType: 'block',
      subjectId: farm.blockId,
      status: 'organic',
      effectiveOn: '2025-01-01'
    });
    expect(imp.status).toBe(403);
    expect(((await imp.json()) as { error: string }).error).toBe('NOT_WHILE_IMPERSONATING');
    actAs(farm, 'owner', { authVia: 'bearer' });
    expect(
      (
        await postStatus({
          subjectType: 'block',
          subjectId: farm.blockId,
          status: 'organic',
          effectiveOn: '2025-01-01'
        })
      ).status
    ).toBe(201);
  });

  it('refuses a non-growing Area and another farm subject', async () => {
    const barn = inFarm(farm, () => createField({ name: 'Barn', kind: 'barn' }));
    const res = await postStatus({
      subjectType: 'field',
      subjectId: barn.id,
      status: 'organic',
      effectiveOn: '2025-01-01'
    });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe('NOT_GROWING_AREA');
    const other = seedFarm();
    for (const [subjectType, subjectId] of [
      ['block', other.blockId],
      ['field', other.fieldId],
      ['animal', hen(other).id]
    ]) {
      const r = await postStatus({
        subjectType,
        subjectId,
        status: 'organic',
        effectiveOn: '2025-01-01'
      });
      expect(r.status).toBe(400);
    }
  });

  it('checks the date range and keeps a future entry from applying yet', async () => {
    for (const effectiveOn of ['1969-12-31', '2025-02-30', ymd(Date.now() + 400 * DAY)]) {
      const r = await postStatus({
        subjectType: 'block',
        subjectId: farm.blockId,
        status: 'organic',
        effectiveOn
      });
      expect(r.status).toBe(400);
    }
    const future = await postStatus({
      subjectType: 'block',
      subjectId: farm.blockId,
      status: 'organic',
      effectiveOn: ymd(Date.now() + 30 * DAY)
    });
    expect(future.status).toBe(201);
    expect(inFarm(farm, () => blockOrganicStatusAt(farm.blockId, Date.now()))).toBeNull();
  });

  it('links a certificate in the same write and refuses a photo or another farm file', async () => {
    const docId = randomUUID();
    inFarm(farm, () =>
      insertDocument({
        id: docId,
        kind: 'certificate',
        title: 'Certificate',
        mime: 'application/pdf',
        byteSize: 10,
        sha256: 'x'.repeat(64),
        crc32: 1,
        storageKey: documentStorageKey(farm.ownerId, docId),
        originalName: 'cert.pdf',
        uploadedBy: farm.ownerUser
      })
    );
    const res = await postStatus({
      subjectType: 'block',
      subjectId: farm.blockId,
      status: 'organic',
      effectiveOn: '2025-01-01',
      documentId: docId
    });
    expect(res.status).toBe(201);
    const history = inFarm(farm, () => listOrganicStatusHistory());
    expect(history[0].documentIds).toEqual([docId]);
    const other = seedFarm();
    actAs(other, 'owner');
    const foreign = await postStatus({
      subjectType: 'block',
      subjectId: other.blockId,
      status: 'organic',
      effectiveOn: '2025-01-01',
      documentId: docId
    });
    expect(foreign.status).toBe(400);
  });

  it('is never gated by the season close-out', async () => {
    inFarm(farm, () =>
      closeSeason({
        year: new Date().getFullYear(),
        closedById: farm.ownerUser,
        plantingResolutions: [],
        harvestRollup: {},
        pendingCount: 0
      })
    );
    const res = await postStatus({
      subjectType: 'block',
      subjectId: farm.blockId,
      status: 'organic',
      effectiveOn: ymd(Date.now())
    });
    expect(res.status).toBe(201);
  });

  it('turns organic chrome on for the farm once an entry exists', async () => {
    await postStatus({
      subjectType: 'block',
      subjectId: farm.blockId,
      status: 'not-organic',
      effectiveOn: '2025-01-01'
    });
    expect(inFarm(farm, () => farmOrganicChrome())).toBe('full');
  });
});

describe('offline snapshot (B-16)', () => {
  it('carries the Area and animal status lines, and null without an entry', async () => {
    const h = hen(farm);
    const before = await runWithTenantAsync(farm.ownerId, () => buildFarmSnapshot());
    expect(before.areas.find((a) => a.id === farm.fieldId)?.organicStatus).toBeNull();
    await postStatus({
      subjectType: 'field',
      subjectId: farm.fieldId,
      status: 'organic',
      effectiveOn: '2025-01-01',
      certifier: 'OCIA'
    });
    await postStatus({
      subjectType: 'animal',
      subjectId: h.id,
      status: 'transitioning',
      effectiveOn: '2025-01-01'
    });
    const snap = await runWithTenantAsync(farm.ownerId, () => buildFarmSnapshot());
    expect(snap.version).toBe(4);
    expect(snap.areas.find((a) => a.id === farm.fieldId)?.organicStatus).toBe(
      'Organic (owner-entered, effective Jan 1, 2025, certifier OCIA)'
    );
    expect(snap.animals?.find((a) => a.id === h.id)?.organicStatus).toBe(
      'Transitioning (owner-entered, effective Jan 1, 2025)'
    );
  });
});

describe('tenant isolation', () => {
  it('another farm never sees or inherits these entries', async () => {
    const h = hen(farm);
    await postStatus({
      subjectType: 'animal',
      subjectId: h.id,
      status: 'organic',
      effectiveOn: '2025-01-01'
    });
    await postStatus({
      subjectType: 'block',
      subjectId: farm.blockId,
      status: 'organic',
      effectiveOn: '2025-01-01'
    });
    const other = seedFarm();
    actAs(other, 'owner');
    const listed = (await (await call(statusGet, { path: '/api/organic/status' })).json()) as {
      entries: unknown[];
    };
    expect(listed.entries).toEqual([]);
    expect(inFarm(other, () => blockOrganicStatusAt(farm.blockId, Date.now()))).toBeNull();
    expect(
      inFarm(other, () => animalOrganicStatusAt({ type: 'animal', id: h.id }, Date.now()))
    ).toBeNull();
    expect(inFarm(other, () => farmOrganicChrome())).not.toBe('full');
  });
});

describe('POST /api/organic/treatment-reviews (B-22 to B-26)', () => {
  async function organicHen() {
    const h = hen(farm);
    await postStatus({
      subjectType: 'animal',
      subjectId: h.id,
      status: 'organic',
      effectiveOn: '2025-01-01'
    });
    return h;
  }

  it('a dewormed hen needs review until the owner answers', async () => {
    const h = await organicHen();
    const dose = dewormer(farm, 'animal', h.id, Date.now() - DAY);
    const rows = inFarm(farm, () => organicTreatmentOutcomes());
    expect(rows.find((r) => r.healthEventId === dose.id)?.outcome).toBe('needs-review');

    actAs(farm, 'helper');
    const helper = await call(reviewPost, {
      method: 'POST',
      json: { healthEventId: dose.id, outcome: 'status-lost', reason: 'Asked the vet.' }
    });
    expect(helper.status).toBe(403);

    actAs(farm, 'owner');
    const res = await call(reviewPost, {
      method: 'POST',
      json: { healthEventId: dose.id, outcome: 'status-lost', reason: 'Not on the allowed list.' }
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { treatment: { outcome: string; basis: string } };
    expect(body.treatment).toMatchObject({ outcome: 'status-lost', basis: 'owner-review' });
    expect(
      isUnderOrganic(
        inFarm(farm, () => animalOrganicStatusAt({ type: 'animal', id: h.id }, Date.now()))
      )
    ).toBe(false);

    const changed = await call(reviewPost, {
      method: 'POST',
      json: {
        healthEventId: dose.id,
        outcome: 'not-affected',
        reason: 'Certifier said it is allowed.'
      }
    });
    expect(changed.status).toBe(200);
    expect(
      isUnderOrganic(
        inFarm(farm, () => animalOrganicStatusAt({ type: 'animal', id: h.id }, Date.now()))
      )
    ).toBe(true);
  });

  it('locks the answer 48 hours after it was first given', async () => {
    const h = await organicHen();
    const dose = dewormer(farm, 'animal', h.id, Date.now() - 5 * DAY);
    inFarm(farm, () =>
      upsertReview({
        healthEventId: dose.id,
        outcome: 'status-lost',
        reason: 'Old answer.',
        createdBy: farm.ownerUser,
        now: Date.now() - 49 * 60 * 60 * 1000
      })
    );
    const res = await call(reviewPost, {
      method: 'POST',
      json: { healthEventId: dose.id, outcome: 'not-affected', reason: 'Changed my mind.' }
    });
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: string }).error).toBe('REVIEW_LOCKED');
    const row = inFarm(farm, () =>
      db
        .select()
        .from(organicTreatmentReviews)
        .where(
          withTenant(organicTreatmentReviews, eq(organicTreatmentReviews.healthEventId, dose.id))
        )
        .get()
    );
    expect(row?.lockedAt).not.toBeNull();
  });

  it('is never gated by the season close-out', async () => {
    const h = await organicHen();
    const dose = dewormer(farm, 'animal', h.id, Date.now() - DAY);
    inFarm(farm, () =>
      closeSeason({
        year: new Date().getFullYear(),
        closedById: farm.ownerUser,
        plantingResolutions: [],
        harvestRollup: {},
        pendingCount: 0
      })
    );
    const res = await call(reviewPost, {
      method: 'POST',
      json: { healthEventId: dose.id, outcome: 'not-affected', reason: 'Allowed by certifier.' }
    });
    expect(res.status).toBe(201);
  });

  it('has nothing to answer for an animal with no status', async () => {
    const h = hen(farm);
    const dose = dewormer(farm, 'animal', h.id, Date.now());
    const res = await call(reviewPost, {
      method: 'POST',
      json: { healthEventId: dose.id, outcome: 'status-lost', reason: 'Testing it.' }
    });
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: string }).error).toBe('REVIEW_NOT_NEEDED');
  });

  it('refuses another farm treatment', async () => {
    const other = seedFarm();
    const h = hen(other);
    const dose = dewormer(other, 'animal', h.id, Date.now());
    const res = await call(reviewPost, {
      method: 'POST',
      json: { healthEventId: dose.id, outcome: 'status-lost', reason: 'Not mine.' }
    });
    expect(res.status).toBe(400);
  });

  it('a group treatment reaches members at the time, not later joiners', async () => {
    const flock = inFarm(farm, () =>
      insertAnimalGroup({
        name: 'Layers',
        speciesId: 'chicken',
        purpose: 'production',
        headCount: 6,
        foodProducing: true
      })
    );
    const member = hen(farm, { groupId: flock.id });
    await postStatus({
      subjectType: 'group',
      subjectId: flock.id,
      status: 'organic',
      effectiveOn: '2025-01-01'
    });
    const dose = dewormer(farm, 'group', flock.id, Date.now() - DAY);
    const row = inFarm(farm, () => organicTreatmentOutcomes()).find(
      (r) => r.healthEventId === dose.id
    );
    expect(row?.subjects).toEqual([
      { type: 'group', id: flock.id },
      { type: 'animal', id: member.id }
    ]);
  });

  it('a deleted dose keeps its loss; a void removes it (B-26)', async () => {
    const h = await organicHen();
    const dose = dewormer(farm, 'animal', h.id, Date.now() - DAY);
    await call(reviewPost, {
      method: 'POST',
      json: { healthEventId: dose.id, outcome: 'status-lost', reason: 'Confirmed with certifier.' }
    });
    const event = inFarm(farm, () => getHealthEvent(dose.id))!;
    inFarm(farm, () =>
      deleteHealthEvent(event, { deletedBy: farm.ownerUser, reason: 'typo', dosed: true })
    );
    const after = inFarm(farm, () => organicTreatmentOutcomes()).find(
      (r) => r.healthEventId === dose.id
    );
    expect(after).toMatchObject({ outcome: 'status-lost', deleted: true });
    expect(after?.review?.reason).toBe('Confirmed with certifier.');

    const h2 = await organicHen();
    const dose2 = dewormer(farm, 'animal', h2.id, Date.now() - DAY);
    await call(reviewPost, {
      method: 'POST',
      json: { healthEventId: dose2.id, outcome: 'status-lost', reason: 'Confirmed with certifier.' }
    });
    const event2 = inFarm(farm, () => getHealthEvent(dose2.id))!;
    inFarm(farm, () =>
      deleteHealthEvent(event2, { deletedBy: farm.ownerUser, reason: 'never given', dosed: false })
    );
    expect(
      inFarm(farm, () => organicTreatmentOutcomes()).some((r) => r.healthEventId === dose2.id)
    ).toBe(false);
    expect(
      isUnderOrganic(
        inFarm(farm, () => animalOrganicStatusAt({ type: 'animal', id: h2.id }, Date.now()))
      )
    ).toBe(true);
  });

  it('a dose deleted before review says so and cannot be answered', async () => {
    const h = await organicHen();
    const dose = dewormer(farm, 'animal', h.id, Date.now() - DAY);
    const event = inFarm(farm, () => getHealthEvent(dose.id))!;
    inFarm(farm, () =>
      deleteHealthEvent(event, { deletedBy: farm.ownerUser, reason: 'dup', dosed: true })
    );
    const row = inFarm(farm, () => organicTreatmentOutcomes()).find(
      (r) => r.healthEventId === dose.id
    );
    expect(row).toMatchObject({ outcome: 'needs-review', deleted: true });
    const res = await call(reviewPost, {
      method: 'POST',
      json: { healthEventId: dose.id, outcome: 'status-lost', reason: 'Too late.' }
    });
    expect(res.status).toBe(400);
  });
});

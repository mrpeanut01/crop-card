// @vitest-environment node
import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { getTableName } from 'drizzle-orm';

const m = vi.hoisted(() => ({ ownerId: '', role: 'owner' }));

vi.mock('$lib/server/auth', () => {
  const user = () => ({
    id: 'export-user',
    email: 'export@test.local',
    phone: null,
    role: m.role,
    activeOwnerId: m.ownerId,
    isSuperadmin: false
  });
  return { currentUser: user, requireUser: user };
});

import { db } from '$lib/db/client';
import {
  animalHealthEvents,
  animalProductionLogs,
  owners,
  recordDeletions,
  taskTimeEntries,
  users
} from '$lib/db/schema';
import { eq } from 'drizzle-orm';
import { createCutting } from '$lib/db/hayCuttings';
import { runWithTenantAsync, runWithTenant, tenantValues, withTenant } from '$lib/db/tenant';
import { createField } from '$lib/db/fields';
import { createBlock } from '$lib/db/blocks';
import { createPlanned, setSowingMethod, setTreeSizeClass } from '$lib/db/crops';
import { createMapFeature } from '$lib/db/mapFeatures';
import { insertSoilTest } from '$lib/db/fertility';
import { insertJournalEntry } from '$lib/db/plantingJournal';
import { PHASE_32_TABLES, seedPhase32Rows, type Phase32Seed } from '$lib/db/phase32.fixtures';
import { GET } from './+server';
import {
  PHASE_33_TABLE_GROUPS,
  RECORD_TABLE_GROUPS,
  dataUrlBytes
} from '$lib/server/accountExportSections';
import { PHASE_33_TABLES, seedPhase33, type Phase33Seed } from '$lib/db/phase33.fixtures';

interface Seeded {
  ownerId: string;
  areaId: string;
  bedId: string;
  featureId: string;
  hydrantId: string;
  soilTestId: string;
  journalId: string;
  phase32: Phase32Seed;
  phase33: Phase33Seed;
}

function seed(label: string): Seeded {
  const ownerId = `export-${label}-${randomUUID()}`;
  db.insert(owners)
    .values({ id: ownerId, name: ownerId, slug: ownerId, billingStatus: 'active' })
    .run();
  const phase33 = seedPhase33(ownerId, `${label}-p33`);
  const farm = runWithTenant(ownerId, () => {
    const area = createField({
      name: `${label} kitchen garden`,
      kind: 'garden',
      widthFt: 20,
      lengthFt: 30
    });
    const bed = createBlock({
      name: `${label} bed`,
      fieldId: area.id,
      kind: 'bed',
      widthFt: 4,
      lengthFt: 8
    });
    const crop = createPlanned({
      blockId: bed.id,
      cropPluginId: 'tomato-amish-paste',
      varietyDisplayName: 'Amish Paste tomato'
    });
    setTreeSizeClass(crop.id, 'dwarf');
    setSowingMethod(crop.id, 'drilled');
    const feature = createMapFeature({
      kind: 'fence',
      name: `${label} fence`,
      fieldId: area.id,
      geometry: {
        type: 'LineString',
        coordinates: [
          [-77.55, 39.1],
          [-77.549, 39.1]
        ]
      }
    });
    const hydrant = createMapFeature({
      kind: 'hydrant',
      name: `${label} hydrant`,
      geometry: { type: 'Point', coordinates: [-77.55, 39.1] },
      areaIds: [area.id]
    });
    const soil = insertSoilTest({ blockId: bed.id, sampledAt: Date.UTC(2026, 3, 1), ph: 6.4 });
    const journal = insertJournalEntry({
      cropId: crop.id,
      blockId: bed.id,
      createdBy: null,
      kind: 'observation',
      text: 'Spots on lower leaves',
      photoRef: 'data:image/jpeg;base64,AAAA',
      provenance: 'manual'
    });
    return {
      ownerId,
      areaId: area.id,
      bedId: bed.id,
      featureId: feature.id,
      hydrantId: hydrant.id,
      soilTestId: soil.id,
      journalId: journal.id,
      phase32: seedPhase32Rows(`${label}-p32`)
    };
  });
  return { ...farm, phase33 };
}

async function exportFor(
  ownerId: string,
  role = 'owner'
): Promise<{ text: string; json: Record<string, unknown> }> {
  m.ownerId = ownerId;
  m.role = role;
  const res = await runWithTenantAsync(ownerId, async () =>
    GET({ locals: {}, url: new URL('http://localhost/api/account/export.json') } as never)
  );
  expect(res.status).toBe(200);
  const text = await res.text();
  return { text, json: JSON.parse(text) as Record<string, unknown> };
}

function idsOf(s: Seeded): string[] {
  return [
    s.areaId,
    s.bedId,
    s.featureId,
    s.hydrantId,
    s.soilTestId,
    s.journalId,
    ...Object.values(s.phase32.rowIds),
    ...Object.values(s.phase33.rowIds)
  ];
}

describe('GET /api/account/export.json', () => {
  db.insert(users)
    .values({ id: 'export-user', email: 'export@test.local' })
    .onConflictDoNothing()
    .run();

  it('lists every Phase 32 table exactly once', () => {
    const exported = Object.values(RECORD_TABLE_GROUPS)
      .flatMap((g) => Object.values(g))
      .map((t) => getTableName(t))
      .sort();
    expect(exported).toEqual(Object.keys(PHASE_32_TABLES).sort());
  });

  it('lists every Phase 33 table exactly once (documents and links in their own section)', () => {
    const exported = Object.values(PHASE_33_TABLE_GROUPS)
      .flatMap((g) => Object.values(g))
      .map((t) => getTableName(t))
      .concat(['documents', 'document_links'])
      .sort();
    expect(exported).toEqual(Object.keys(PHASE_33_TABLES).sort());
  });

  it('counts decoded photo bytes, not data URL characters', () => {
    expect(dataUrlBytes('data:image/jpeg;base64,AAAA')).toBe(3);
    expect(dataUrlBytes('data:image/jpeg;base64,AAA=')).toBe(2);
    expect(dataUrlBytes('data:image/jpeg;base64,AA==')).toBe(1);
    expect(dataUrlBytes(null)).toBe(0);
    expect(dataUrlBytes('not a data url')).toBe(0);
  });

  it("exports Phase 33 rows and document metadata without storage keys, and no other Owner's", async () => {
    const a = seed('p33-a');
    const b = seed('p33-b');
    const { text, json } = await exportFor(a.ownerId);
    const docs = json.documents as Array<Record<string, unknown>>;
    expect(docs).toHaveLength(1);
    expect(docs[0]).toMatchObject({
      id: a.phase33.documentId,
      kind: 'lab-report',
      mime: 'application/pdf',
      sha256: 'a'.repeat(64),
      deletedAt: null,
      links: [
        expect.objectContaining({
          subjectType: 'soil-test',
          subjectId: a.phase33.subjects['soil-test']
        })
      ]
    });
    expect(docs[0]).not.toHaveProperty('storageKey');
    expect(text).not.toContain(a.phase33.storageKey);
    const organic = json.organic as Record<string, Array<{ id: string }>>;
    expect(organic.harvestDispositions.map((r) => r.id)).toEqual([
      a.phase33.rowIds.harvest_dispositions
    ]);
    const amendments = json.amendments as Record<string, Array<{ id: string }>>;
    expect(amendments.forageTests.map((r) => r.id)).toEqual([a.phase33.rowIds.forage_tests]);
    for (const id of Object.values(b.phase33.rowIds)) expect(text).not.toContain(id);
  });

  it.each(['helper', 'inspector'])(
    "leaves documents out of a %s's export so owner-only titles never leak",
    async (role) => {
      const farm = seed(`p33-${role}`);
      const { text, json } = await exportFor(farm.ownerId, role);
      expect(json).not.toHaveProperty('documents');
      expect(text).not.toContain('soil report');
      expect(text).not.toContain(farm.phase33.storageKey);
    }
  );

  it("contains Areas, map features, soil tests, the journal and Phase 32 rows, and no other Owner's", async () => {
    const a = seed('a');
    const b = seed('b');
    for (const [self, other] of [
      [a, b],
      [b, a]
    ] as const) {
      const { text, json } = await exportFor(self.ownerId);
      for (const id of idsOf(self)) expect(text, id).toContain(id);
      for (const id of idsOf(other)) expect(text, id).not.toContain(id);
      expect(text).not.toContain(other.ownerId);

      const areas = json.areas as Array<{ id: string; kind: string; widthFt: number }>;
      expect(areas.find((x) => x.id === self.areaId)).toMatchObject({
        kind: 'garden',
        widthFt: 20
      });
      const blocks = json.blocks as Array<{
        id: string;
        fieldId: string;
        kind: string;
        widthFt: number;
        layout: Record<string, unknown>;
      }>;
      const bed = blocks.find((x) => x.id === self.bedId);
      expect(bed).toMatchObject({ fieldId: self.areaId, kind: 'bed', widthFt: 4 });
      const planted = (bed as unknown as { plantings: Array<Record<string, unknown>> }).plantings;
      expect(planted[0]).toMatchObject({
        treeSizeClass: 'dwarf',
        sowingMethod: 'drilled'
      });
      expect(Object.keys(bed!.layout)).toEqual(
        expect.arrayContaining(['xFt', 'yFt', 'rotationDeg', 'bedStyle'])
      );
      const features = json.mapFeatures as Array<{ id: string; kind: string }>;
      expect(features.map((f) => f.id)).toEqual([self.featureId, self.hydrantId]);
      expect(json.mapFeatureAreas).toEqual([
        expect.objectContaining({ featureId: self.hydrantId, fieldId: self.areaId })
      ]);
      const soil = json.soilTests as Array<{ id: string; ph: number }>;
      expect(soil.find((t) => t.id === self.soilTestId)).toMatchObject({ ph: 6.4 });
      const journal = json.plantingJournal as Array<{ id: string; photoBytes: number }>;
      expect(journal.find((j) => j.id === self.journalId)?.photoBytes).toBe(3);

      const animals = json.animals as Record<string, Array<{ id: string }>>;
      expect(animals.groups.map((r) => r.id).sort()).toEqual(
        [self.phase32.rowIds.animal_groups, self.phase33.phase32.rowIds.animal_groups].sort()
      );
      const operations = json.operations as Record<string, Array<{ id: string }>>;
      expect(operations.ledgerEntries.map((r) => r.id).sort()).toEqual(
        [self.phase32.rowIds.ledger_entries, self.phase33.phase32.rowIds.ledger_entries].sort()
      );
    }
  });

  it("includes deleted and voided records with their saved copy, and no other Owner's (review round 8)", async () => {
    const a = seed('del-a');
    const b = seed('del-b');
    const tomb = (farm: Seeded) =>
      runWithTenant(farm.ownerId, () => {
        const id = randomUUID();
        const recordId = randomUUID();
        db.insert(recordDeletions)
          .values(
            tenantValues({
              id,
              recordKind: 'animal-health' as const,
              recordId,
              deletedBy: 'export-user',
              reason: 'wrong animal',
              snapshotJson: JSON.stringify({
                event: { id: recordId, productName: 'Drench' },
                dosed: true
              })
            })
          )
          .run();
        return recordId;
      });
    const mine = tomb(a);
    const theirs = tomb(b);
    for (const role of ['owner', 'helper']) {
      const { text, json } = await exportFor(a.ownerId, role);
      const deleted = json.deletedRecords as Array<{
        recordId: string;
        recordKind: string;
        reason: string;
        snapshot: { dosed: boolean; event: { productName: string } };
      }>;
      expect(deleted).toEqual([
        expect.objectContaining({
          recordId: mine,
          recordKind: 'animal-health',
          reason: 'wrong animal',
          snapshot: { dosed: true, event: { id: mine, productName: 'Drench' } }
        })
      ]);
      expect(text).not.toContain(theirs);
    }
  });

  it('carries recordedLate on hay cuttings and animal records (G2-10)', async () => {
    const farm = seed('late');
    const DAY = 86_400_000;
    const [late, onTime] = runWithTenant(farm.ownerId, () => {
      const make = (mowAt: number) =>
        createCutting({
          blockId: farm.bedId,
          cropPluginId: 'alfalfa-vernema',
          year: 2026,
          mowAt,
          rulesVersion: 'test'
        });
      const ids = [make(Date.now() - 5 * DAY).id, make(Date.now()).id];
      const ids32 = farm.phase32.rowIds;
      db.update(animalHealthEvents)
        .set({ recordedLate: true })
        .where(
          withTenant(animalHealthEvents, eq(animalHealthEvents.id, ids32.animal_health_events))
        )
        .run();
      db.update(animalProductionLogs)
        .set({ recordedLate: true })
        .where(
          withTenant(
            animalProductionLogs,
            eq(animalProductionLogs.id, ids32.animal_production_logs)
          )
        )
        .run();
      return ids;
    });

    const { json } = await exportFor(farm.ownerId);
    expect(json.schemaVersion).toBe('1.6.0');
    const hay = json.hayCuttings as Array<{ id: string; recordedLate: boolean }>;
    expect(hay.find((c) => c.id === late)?.recordedLate).toBe(true);
    expect(hay.find((c) => c.id === onTime)?.recordedLate).toBe(false);

    const animals = json.animals as Record<string, Array<{ id: string; recordedLate: boolean }>>;
    const ids32 = farm.phase32.rowIds;
    expect(animals.healthEvents.find((r) => r.id === ids32.animal_health_events)).toMatchObject({
      recordedLate: true
    });
    expect(animals.productionLogs.find((r) => r.id === ids32.animal_production_logs)).toMatchObject(
      { recordedLate: true }
    );
    expect(animals.statusEvents.find((r) => r.id === ids32.animal_status_events)).toMatchObject({
      recordedLate: false
    });
  });

  it.each(['helper', 'inspector'])(
    'gives a %s their own time entries and no ledger',
    async (role) => {
      const farm = seed(`role-${role}`);
      const mine = randomUUID();
      runWithTenant(farm.ownerId, () =>
        db
          .insert(taskTimeEntries)
          .values(tenantValues({ id: mine, userId: 'export-user', minutes: 45 }))
          .run()
      );

      const { text, json } = await exportFor(farm.ownerId, role);
      const operations = json.operations as Record<string, Array<{ id: string }> | undefined>;
      expect(operations.ledgerEntries).toBeUndefined();
      expect(operations.ledgerEntryChanges).toBeUndefined();
      expect(text).not.toContain(farm.phase32.rowIds.ledger_entries);
      expect(text).not.toContain(farm.phase32.rowIds.ledger_entry_changes);
      // A disposition's sale link is money too.
      expect(text).not.toContain(farm.phase33.phase32.rowIds.ledger_entries);
      expect(operations.taskTimeEntries?.map((r) => r.id)).toEqual([mine]);
      expect(text).not.toContain(farm.phase32.rowIds.task_time_entries);

      const owner = await exportFor(farm.ownerId, 'owner');
      expect(owner.text).toContain(farm.phase32.rowIds.ledger_entries);
      expect(owner.text).toContain(farm.phase32.rowIds.ledger_entry_changes);
      expect(owner.text).toContain(farm.phase33.phase32.rowIds.ledger_entries);
      expect(owner.text).toContain(farm.phase32.rowIds.task_time_entries);
    }
  );
});

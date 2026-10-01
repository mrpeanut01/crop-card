import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { db } from './client';
import {
  type DocumentSubjectType,
  amendmentBatchInputs,
  amendmentBatches,
  amendmentBioassays,
  amendmentDismissals,
  documentLinks,
  documents,
  forageTests,
  harvestDispositions,
  organicStatusEvents,
  organicTreatmentReviews
} from './schema';
import { type TenantScopedTable, runWithTenant, tenantValues, withTenant } from './tenant';
import { createBlock } from './blocks';
import { createPlanned } from './crops';
import { createField } from './fields';
import { insertFertilityApplication, insertSoilTest } from './fertility';
import { insertHarvestEvent } from './harvestEvents';
import { createCutting } from './hayCuttings';
import { documentStorageKey } from './documents';
import { type Phase32Seed, seedPhase32Rows } from './phase32.fixtures';

/** Every tenant-scoped table Phase 33 adds, keyed by SQL name. Test-only.
 *  `blob_deletions` is global and deliberately absent. */
export const PHASE_33_TABLES = {
  documents,
  document_links: documentLinks,
  organic_status_events: organicStatusEvents,
  organic_treatment_reviews: organicTreatmentReviews,
  harvest_dispositions: harvestDispositions,
  amendment_batches: amendmentBatches,
  amendment_batch_inputs: amendmentBatchInputs,
  amendment_bioassays: amendmentBioassays,
  amendment_dismissals: amendmentDismissals,
  forage_tests: forageTests
} as const;

export type Phase33Table = keyof typeof PHASE_33_TABLES;

export interface Phase33Seed {
  ownerId: string;
  rowIds: Record<Phase33Table, string>;
  /** One id of this Owner for every document subject type. */
  subjects: Record<DocumentSubjectType, string>;
  documentId: string;
  storageKey: string;
  hayCuttingId: string;
  phase32: Phase32Seed;
}

/** One linked row in every Phase 33 table for `ownerId`, plus the parents
 *  they point at. The owner row must already exist. */
export function seedPhase33(
  ownerId: string,
  label = `p33-${randomUUID().slice(0, 8)}`
): Phase33Seed {
  return runWithTenant(ownerId, () => {
    const now = Date.now();
    const phase32 = seedPhase32Rows(label);
    const field = createField({ name: `${label}-garden`, kind: 'garden' });
    const block = createBlock({ name: `${label}-bed`, fieldId: field.id, acres: 0.1 });
    const crop = createPlanned({
      blockId: block.id,
      cropPluginId: 'crop:tomato',
      varietyDisplayName: 'Roma'
    });
    const soil = insertSoilTest({ blockId: block.id, sampledAt: now, ph: 6.5 });
    const harvest = insertHarvestEvent({
      blockId: block.id,
      cropId: crop.id,
      cropPluginId: 'crop:tomato',
      occurredAt: now,
      quantity: '20 lb'
    });
    const cutting = createCutting({
      blockId: block.id,
      cropPluginId: 'alfalfa-vernema',
      year: new Date(now).getUTCFullYear(),
      mowAt: now,
      rulesVersion: 'test'
    });
    const fertility = insertFertilityApplication({
      blockId: block.id,
      occurredAt: now,
      source: 'compost',
      ratePerAcre: 10,
      rateUnit: 'ton'
    });

    const id = () => `${label}-${randomUUID()}`;
    const rowIds = {} as Record<Phase33Table, string>;
    const put = <T extends Phase33Table>(
      name: T,
      values: Omit<(typeof PHASE_33_TABLES)[T]['$inferInsert'], 'id' | 'ownerId'>,
      rowId: string = id()
    ) => {
      db.insert(PHASE_33_TABLES[name])
        .values(tenantValues({ ...values, id: rowId }) as never)
        .run();
      rowIds[name] = rowId;
      return rowId;
    };

    const documentId = randomUUID();
    const storageKey = documentStorageKey(ownerId, documentId);
    put(
      'documents',
      {
        kind: 'lab-report',
        title: `${label} soil report`,
        mime: 'application/pdf',
        byteSize: 1234,
        sha256: 'a'.repeat(64),
        crc32: 42,
        storageKey,
        originalName: 'report.pdf',
        uploadedBy: null
      },
      documentId
    );
    const statusId = put('organic_status_events', {
      subjectType: 'block',
      subjectId: block.id,
      status: 'transitioning',
      effectiveAt: new Date(now),
      certifier: 'Example Certifier'
    });
    put('organic_treatment_reviews', {
      healthEventId: phase32.rowIds.animal_health_events,
      outcome: 'status-lost',
      reason: 'Antibiotic course'
    });
    put('harvest_dispositions', {
      harvestEventId: harvest.id,
      kind: 'sold',
      quantityHundredths: 1500,
      unit: 'lb',
      occurredAt: new Date(now),
      recipient: 'Farmers market',
      soldAsOrganic: false,
      ledgerEntryId: phase32.rowIds.ledger_entries
    });
    const batchId = put('amendment_batches', {
      kind: 'manure',
      name: `${label} pile`,
      origin: 'on-farm',
      startedAt: new Date(now)
    });
    put('amendment_batch_inputs', {
      batchId,
      inputType: 'group',
      inputId: phase32.groupId,
      fromAt: new Date(now - 86_400_000),
      toAt: new Date(now)
    });
    put('amendment_bioassays', {
      blockId: block.id,
      testedAt: new Date(now),
      result: 'no-damage'
    });
    put('amendment_dismissals', {
      fertilityApplicationId: fertility.id,
      blockId: block.id,
      reason: 'Batch went on the lawn, not this bed'
    });
    const forageId = put('forage_tests', {
      hayCuttingId: cutting.id,
      sampledAt: new Date(now),
      lab: 'Example Lab',
      nitrateValueHundredths: 150000,
      nitrateUnits: 'ppm-nitrate',
      documentId,
      provenance: 'manual'
    });

    const subjects: Record<DocumentSubjectType, string> = {
      'soil-test': soil.id,
      'stock-lot': phase32.stockLotId,
      animal: phase32.animalId,
      'animal-group': phase32.groupId,
      'animal-health': phase32.rowIds.animal_health_events,
      field: field.id,
      block: block.id,
      'harvest-event': harvest.id,
      'ledger-entry': phase32.rowIds.ledger_entries,
      'organic-status': statusId,
      'amendment-batch': batchId,
      'forage-test': forageId,
      farm: ownerId
    };
    put('document_links', { documentId, subjectType: 'soil-test', subjectId: soil.id });

    return {
      ownerId,
      rowIds,
      subjects,
      documentId,
      storageKey,
      hayCuttingId: cutting.id,
      phase32
    };
  });
}

/** Ids of the active tenant's rows in one Phase 33 table. */
export function listPhase33Ids(name: Phase33Table, onlyId?: string): string[] {
  const table = PHASE_33_TABLES[name] as unknown as TenantScopedTable & {
    id: typeof documents.id;
  };
  return (
    db
      .select({ id: table.id })
      .from(table)
      .where(withTenant(table, onlyId ? eq(table.id, onlyId) : undefined))
      .all() as Array<{ id: string }>
  ).map((r) => r.id);
}

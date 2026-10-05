import { desc, eq } from 'drizzle-orm';
import { db } from '$lib/db/client';
import {
  amendmentBatchInputs,
  amendmentBatches,
  amendmentBioassays,
  amendmentDismissals,
  documentLinks,
  documents,
  forageTests,
  harvestDispositions,
  organicStatusEvents,
  organicTreatmentReviews,
  plantingJournal,
  animalCarePlans,
  animalFlagChanges,
  holdCorrections,
  animalGroups,
  animalHealthEvents,
  animalLocations,
  animalProductionLogs,
  animalStatusEvents,
  animals,
  blockProtections,
  grazingAttestations,
  irrigationEvents,
  ledgerEntries,
  ledgerEntryChanges,
  rainGaugeReadings,
  recordDeletions,
  seedStarts,
  soilTests,
  taskTimeEntries
} from '$lib/db/schema';
import { type TenantScopedTable, withTenant } from '$lib/db/tenant';
import { listFields } from '$lib/db/fields';
import { listMapFeatureAreaLinks, listMapFeatures } from '$lib/db/mapFeatures';
import { listShadeSources } from '$lib/db/shadeSources';

/** Every Phase 32 table, grouped the way the export file shows them. */
export const RECORD_TABLE_GROUPS = {
  animals: {
    groups: animalGroups,
    animals,
    locations: animalLocations,
    healthEvents: animalHealthEvents,
    productionLogs: animalProductionLogs,
    statusEvents: animalStatusEvents,
    grazingAttestations,
    flagChanges: animalFlagChanges,
    carePlans: animalCarePlans,
    holdCorrections
  },
  growing: {
    seedStarts,
    blockProtections,
    irrigationEvents,
    rainGaugeReadings
  },
  operations: {
    taskTimeEntries,
    ledgerEntries,
    ledgerEntryChanges
  }
} as const satisfies Record<string, Record<string, TenantScopedTable>>;

/** Every tenant-scoped Phase 33 table except `documents` and
 *  `document_links`, which `documentSection` exports owner-only. */
export const PHASE_33_TABLE_GROUPS = {
  organic: {
    statusEvents: organicStatusEvents,
    treatmentReviews: organicTreatmentReviews,
    harvestDispositions
  },
  amendments: {
    batches: amendmentBatches,
    batchInputs: amendmentBatchInputs,
    bioassays: amendmentBioassays,
    dismissals: amendmentDismissals,
    forageTests
  }
} as const satisfies Record<string, Record<string, TenantScopedTable>>;

type Groups = typeof RECORD_TABLE_GROUPS;
type Section<G extends Record<string, TenantScopedTable>> = { [K in keyof G]: unknown[] };

function tenantRows(table: TenantScopedTable): unknown[] {
  return db.select().from(table).where(withTenant(table)).all();
}

function readGroup<G extends Record<string, TenantScopedTable>>(group: G): Section<G> {
  const out = {} as Section<G>;
  for (const key of Object.keys(group) as Array<keyof G>) out[key] = tenantRows(group[key]);
  return out;
}

export interface ExportViewer {
  id: string;
  role: string;
}

type Operations = Partial<Section<Groups['operations']>>;

/** Owners get the whole farm. Anyone else gets their own time entries and
 *  never the ledger (finance is owner-only). */
function operationsFor(viewer: ExportViewer): Operations {
  if (viewer.role === 'owner') return readGroup(RECORD_TABLE_GROUPS.operations);
  return {
    taskTimeEntries: db
      .select()
      .from(taskTimeEntries)
      .where(withTenant(taskTimeEntries, eq(taskTimeEntries.userId, viewer.id)))
      .all()
  };
}

export function recordSections(viewer: ExportViewer): {
  animals: Section<Groups['animals']>;
  growing: Section<Groups['growing']>;
  operations: Operations;
} {
  return {
    animals: readGroup(RECORD_TABLE_GROUPS.animals),
    growing: readGroup(RECORD_TABLE_GROUPS.growing),
    operations: operationsFor(viewer)
  };
}

const iso = (ms: number) => new Date(ms).toISOString();

export function areaSection() {
  return listFields().map((f) => ({ ...f, createdAt: iso(f.createdAt) }));
}

export function mapFeatureSection() {
  return listMapFeatures().map((f) => ({ ...f, createdAt: iso(f.createdAt) }));
}

/** Which Areas each hydrant or waterer serves (#478). */
export function mapFeatureAreaSection() {
  return listMapFeatureAreaLinks();
}

export function shadeSourceSection() {
  return listShadeSources();
}

function parseJson(raw: string | null): unknown {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return raw;
  }
}

/** Deleted and voided records with their saved copy (review round 8): a
 *  deleted dose, spray or log can still hold food, and `holdCorrections`
 *  names records that are only here. */
export function deletedRecordSection() {
  return db
    .select()
    .from(recordDeletions)
    .where(withTenant(recordDeletions))
    .orderBy(desc(recordDeletions.deletedAt))
    .all()
    .map((r) => ({
      id: r.id,
      recordKind: r.recordKind,
      recordId: r.recordId,
      deletedBy: r.deletedBy ?? null,
      reason: r.reason ?? null,
      deletedAt: r.deletedAt.toISOString(),
      snapshot: parseJson(r.snapshotJson)
    }));
}

const hundredths = (n: number | null) => (n == null ? null : n / 100);

export function soilTestSection() {
  return db
    .select()
    .from(soilTests)
    .where(withTenant(soilTests))
    .orderBy(desc(soilTests.sampledAt))
    .all()
    .map((r) => ({
      id: r.id,
      blockId: r.blockId,
      sampledAt: r.sampledAt.toISOString(),
      lab: r.lab ?? null,
      reportPdfUrl: r.reportPdfUrl ?? null,
      extractionMethod: r.extractionMethod ?? null,
      unitsBasis: r.unitsBasis ?? null,
      ph: hundredths(r.ph),
      bufferPh: hundredths(r.bufferPhHundredths),
      cec: hundredths(r.cecHundredths),
      organicMatterPct: hundredths(r.organicMatterPctHundredths),
      nitrate: r.nitratePpm ?? null,
      phosphorus: r.phosphorusPpm ?? null,
      potassium: r.potassiumPpm ?? null,
      calcium: r.caPpm ?? null,
      magnesium: r.mgPpm ?? null,
      labRating: parseJson(r.labRatingJson),
      provenance: r.provenance ?? null,
      documentId: r.documentId ?? null,
      notes: r.notes ?? null
    }));
}

type Phase33Groups = typeof PHASE_33_TABLE_GROUPS;

/** A disposition's link to a sale is money, so only the owner sees it
 *  (as `presentDisposition` does in the app). */
export function phase33Sections(viewer: ExportViewer): {
  organic: Section<Phase33Groups['organic']>;
  amendments: Section<Phase33Groups['amendments']>;
} {
  const read = readGroup(PHASE_33_TABLE_GROUPS.organic);
  const organic =
    viewer.role === 'owner'
      ? read
      : {
          ...read,
          harvestDispositions: (read.harvestDispositions as Array<Record<string, unknown>>).map(
            (d) => ({ ...d, ledgerEntryId: null })
          )
        };
  return {
    organic,
    amendments: readGroup(PHASE_33_TABLE_GROUPS.amendments)
  };
}

const isoOrNull = (d: Date | null) => (d ? d.toISOString() : null);

/** Document metadata with its links (A-14). Never the storage key. Owners
 *  only: a helper's export must not name owner-only files. */
export function documentSection(viewer: ExportViewer) {
  if (viewer.role !== 'owner') return undefined;
  const links = db.select().from(documentLinks).where(withTenant(documentLinks)).all();
  const byDoc = new Map<string, Array<{ id: string; subjectType: string; subjectId: string }>>();
  for (const l of links) {
    const list = byDoc.get(l.documentId) ?? [];
    list.push({ id: l.id, subjectType: l.subjectType, subjectId: l.subjectId });
    byDoc.set(l.documentId, list);
  }
  return db
    .select()
    .from(documents)
    .where(withTenant(documents))
    .orderBy(desc(documents.createdAt))
    .all()
    .map((d) => ({
      id: d.id,
      kind: d.kind,
      title: d.title,
      mime: d.mime,
      byteSize: d.byteSize,
      sha256: d.sha256,
      originalName: d.originalName ?? null,
      uploadedBy: d.uploadedBy ?? null,
      createdAt: d.createdAt.toISOString(),
      deletedAt: isoOrNull(d.deletedAt),
      deletedBy: d.deletedBy ?? null,
      links: byDoc.get(d.id) ?? []
    }));
}

/** Decoded bytes of a `data:...;base64,` URL, or 0. */
export function dataUrlBytes(ref: string | null | undefined): number {
  if (!ref) return 0;
  const comma = ref.indexOf(',');
  if (comma < 0 || !/;base64$/i.test(ref.slice(0, comma))) return 0;
  const b64 = ref.slice(comma + 1).replace(/\s/g, '');
  const pad = b64.endsWith('==') ? 2 : b64.endsWith('=') ? 1 : 0;
  return Math.max(0, Math.floor((b64.length * 3) / 4) - pad);
}

/** Journal photo facts by entry id: the vault document (if moved) and the
 *  photo's byte count from whichever column holds it. */
export function journalPhotoFacts(): Map<
  string,
  { photoDocumentId: string | null; photoBytes: number }
> {
  const rows = db
    .select({
      id: plantingJournal.id,
      photoRef: plantingJournal.photoRef,
      photoDocumentId: plantingJournal.photoDocumentId
    })
    .from(plantingJournal)
    .where(withTenant(plantingJournal))
    .all();
  const sizes = new Map<string, number>();
  if (rows.some((r) => r.photoDocumentId)) {
    for (const d of db
      .select({ id: documents.id, byteSize: documents.byteSize, deletedAt: documents.deletedAt })
      .from(documents)
      .where(withTenant(documents))
      .all()) {
      sizes.set(d.id, d.deletedAt ? 0 : d.byteSize);
    }
  }
  return new Map(
    rows.map((r) => [
      r.id,
      {
        photoDocumentId: r.photoDocumentId ?? null,
        photoBytes: r.photoDocumentId
          ? (sizes.get(r.photoDocumentId) ?? 0)
          : dataUrlBytes(r.photoRef)
      }
    ])
  );
}

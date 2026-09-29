import { desc, eq } from 'drizzle-orm';
import { db } from '$lib/db/client';
import {
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
    ledgerEntries
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

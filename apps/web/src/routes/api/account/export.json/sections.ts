import { desc } from 'drizzle-orm';
import { db } from '$lib/db/client';
import {
  animalCarePlans,
  animalFlagChanges,
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
  seedStarts,
  soilTests,
  taskTimeEntries
} from '$lib/db/schema';
import { type TenantScopedTable, withTenant } from '$lib/db/tenant';
import { listFields } from '$lib/db/fields';
import { listMapFeatures } from '$lib/db/mapFeatures';
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
    carePlans: animalCarePlans
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

export function recordSections(): { [K in keyof Groups]: Section<Groups[K]> } {
  return {
    animals: readGroup(RECORD_TABLE_GROUPS.animals),
    growing: readGroup(RECORD_TABLE_GROUPS.growing),
    operations: readGroup(RECORD_TABLE_GROUPS.operations)
  };
}

const iso = (ms: number) => new Date(ms).toISOString();

export function areaSection() {
  return listFields().map((f) => ({ ...f, createdAt: iso(f.createdAt) }));
}

export function mapFeatureSection() {
  return listMapFeatures().map((f) => ({ ...f, createdAt: iso(f.createdAt) }));
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

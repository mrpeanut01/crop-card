/**
 * UC-46 — Year-end summary report (deterministic aggregate).
 *
 * Pure, read-only roll-up over a single (owner, year) of operational data.
 * There is no migration and no write path here — this module only *reads*
 * (through the tenant-scoped repos, Invariant 6) and folds the rows into a
 * `YearSummary` shape that the /records "Year in review" surface and the
 * `GET /api/records/year-summary.pdf` endpoint both render.
 *
 * Two layers so the fold is unit-testable without a DB:
 *   - `computeYearSummary(input)` — pure. Takes already-fetched rows and
 *     a small set of resolver callbacks; returns the aggregate. This is
 *     what the vitest fixtures exercise.
 *   - `buildYearSummary(year)` — orchestrator. Pulls the rows via the
 *     tenant-scoped repos (`listSprayEvents`, `listInsecticideEvents`,
 *     `listFungicideEvents`, `listHarvestEvents`, `listScoutObservations`,
 *     `listBlocks`, `listSprayers`, stock movements) and the plugin
 *     registry, then delegates to `computeYearSummary`.
 *
 * Deterministic-first (Invariant 7): the tables are the product. An AI
 * narrative is an *optional* enrichment layered on top; this module never
 * calls Claude and completes end-to-end with no key.
 *
 * Moisture note: `harvest_events` does not carry a dedicated `moisture_pct`
 * column (the archetype renderers pack it into the lot tag as
 * `moisture=<n>%`, Sprint 13/19). To stay migration-free we parse that tag
 * out of the harvest row's `quantity`/`lotNumber` text — see
 * `parseMoisturePct`. When a future schema lift adds the column, swap the
 * parse for a direct read; the aggregate shape is unchanged.
 */

import type { Philosophy } from '$lib/season/setup';
import type { Archetype } from '$lib/plugins/schemas';

// ─── Public shape ───────────────────────────────────────────────────────

export interface ProductAcreage {
  /** Plugin id (or free-text product name when no plugin id was recorded). */
  productId: string;
  displayName: string;
  /** Chemistry / IRAC / FRAC class labels seen for this product. */
  classes: string[];
  applicationCount: number;
  /** Sum of treated block acreage across every application of this product.
   *  A block sprayed twice counts its acreage twice (treated-acre-passes). */
  acresTreated: number;
}

export interface ChemistryClassAcreage {
  className: string;
  applicationCount: number;
  acresTreated: number;
}

export interface PhilosophyRollup {
  /** The Season-Setup philosophy this year was evaluated against. */
  philosophy: Philosophy;
  totalApplications: number;
  /** Applications whose products were ALL allowed under `philosophy`. */
  compliantApplications: number;
  /** Applications with at least one non-compliant (or unknown) product. */
  nonCompliantApplications: number;
  /** Applications we could not evaluate (no plugin resolved). */
  unknownApplications: number;
}

export interface HarvestArchetypeTotal {
  archetype: Archetype;
  cropPluginIds: string[];
  eventCount: number;
  /** Distinct crop plugins rolled into this archetype bucket. */
  cropCount: number;
  moisture: {
    /** Count of events that carried a parseable moisture reading. */
    sampleCount: number;
    min: number | null;
    max: number | null;
    mean: number | null;
  };
}

export interface InputCostLine {
  category: string;
  /** Total inferred spend, in cents, for consumption of this category. */
  costCents: number;
}

export interface ScoutFunnel {
  scoutObservations: number;
  /** Insecticide/fungicide applications that carried a scout/disease
   *  observation whose value met-or-exceeded its threshold. */
  thresholdTriggeredApplications: number;
  /** At-threshold observations that saw no application in the same block
   *  within the follow-up window — "sprays avoided" via IPM discipline.
   *  Best-effort; see `computeScoutFunnel`. */
  spraysAvoided: number;
}

export interface ComplianceStats {
  sprayerCount: number;
  calibratedSprayerCount: number;
  /** Sprayers calibrated at least once within the summarized year. */
  calibratedThisYear: number;
  deconEventsThisYear: number;
}

export interface YearSummary {
  year: number;
  ownerId: string | null;
  generatedAtMs: number;
  totals: {
    sprayApplications: number;
    insecticideApplications: number;
    fungicideApplications: number;
    totalApplications: number;
    harvestEvents: number;
    /** Distinct blocks that saw at least one application this year. */
    blocksTreated: number;
  };
  productAcreage: ProductAcreage[];
  chemistryClassAcreage: ChemistryClassAcreage[];
  philosophy: PhilosophyRollup;
  harvestByArchetype: HarvestArchetypeTotal[];
  inputCosts: {
    lines: InputCostLine[];
    totalCents: number;
  };
  scoutFunnel: ScoutFunnel;
  compliance: ComplianceStats;
}

// ─── Input rows (repo-shaped subsets — kept narrow for testability) ──────

export interface SprayApplicationRow {
  kind: 'herbicide' | 'insecticide' | 'fungicide';
  blockId: string;
  occurredAtMs: number;
  products: Array<{
    productId: string;
    displayName: string;
    classes: string[];
  }>;
  /** For the scout funnel: an observation value / threshold, when the
   *  event carried one (insecticide/fungicide only). */
  observation?: { value: number; threshold?: number };
}

export interface HarvestRow {
  cropPluginId: string;
  occurredAtMs: number;
  /** Free-text fields the renderers pack moisture into. */
  quantity?: string;
  lotNumber?: string;
}

export interface ScoutRow {
  blockId: string;
  occurredAtMs: number;
  value: number;
}

export interface MovementCostRow {
  category: string;
  /** Negative consumption magnitude (hundredths of the default unit). */
  deltaHundredths: number;
  /** Lot cost per whole unit, in cents. Null when unknown. */
  lotCostCentsPerUnit: number | null;
  reason: string;
}

export interface SprayerComplianceRow {
  calibratedGpa: number | null;
  calibrationDateMs?: number;
  lastDeconAtMs?: number;
}

export interface ComputeYearSummaryInput {
  year: number;
  ownerId: string | null;
  generatedAtMs: number;
  philosophy: Philosophy;
  applications: SprayApplicationRow[];
  harvests: HarvestRow[];
  scoutObservations: ScoutRow[];
  movements: MovementCostRow[];
  sprayers: SprayerComplianceRow[];
  /** Resolves a block id to its acreage (0 when unknown). */
  acresForBlock: (blockId: string) => number;
  /** Resolves a crop plugin id to its harvest archetype. */
  archetypeForPlugin: (cropPluginId: string) => Archetype;
  /** True when the product (resolved to a plugin) is allowed under the
   *  philosophy. Returns `undefined` when the product can't be resolved. */
  productAllowed: (productId: string) => boolean | undefined;
}

// ─── Helpers ─────────────────────────────────────────────────────────────

const MOISTURE_TAG = /moisture\s*=?\s*([0-9]+(?:\.[0-9]+)?)\s*%/i;

/** Extracts a moisture reading packed into a harvest row's text fields.
 *  Matches the `moisture=<n>%` tag the archetype renderers write. Returns
 *  null when no parseable reading is present. */
export function parseMoisturePct(row: HarvestRow): number | null {
  for (const field of [row.quantity, row.lotNumber]) {
    if (!field) continue;
    const m = MOISTURE_TAG.exec(field);
    if (m) {
      const n = Number.parseFloat(m[1]);
      if (Number.isFinite(n) && n >= 0 && n <= 100) return n;
    }
  }
  return null;
}

/** Follow-up window used by the scout funnel: an at-threshold observation
 *  that saw no application in the same block within this window counts as a
 *  "spray avoided". */
const SCOUT_FOLLOWUP_MS = 14 * 24 * 60 * 60 * 1000;

// ─── Pure fold ───────────────────────────────────────────────────────────

export function computeYearSummary(input: ComputeYearSummaryInput): YearSummary {
  const productMap = new Map<string, ProductAcreage>();
  const classMap = new Map<string, ChemistryClassAcreage>();
  const blocksTreated = new Set<string>();

  let herbicide = 0;
  let insecticide = 0;
  let fungicide = 0;

  let compliant = 0;
  let nonCompliant = 0;
  let unknown = 0;

  for (const app of input.applications) {
    blocksTreated.add(app.blockId);
    if (app.kind === 'herbicide') herbicide += 1;
    else if (app.kind === 'insecticide') insecticide += 1;
    else fungicide += 1;

    const acres = input.acresForBlock(app.blockId);

    // Per-product acreage + class acreage. Each product on a tank-mix gets
    // its own treated-acre pass; classes are de-duped per application so a
    // product carrying the same class twice isn't double-counted.
    const classesThisApp = new Set<string>();
    for (const product of app.products) {
      const existing = productMap.get(product.productId);
      if (existing) {
        existing.applicationCount += 1;
        existing.acresTreated += acres;
        for (const c of product.classes) {
          if (!existing.classes.includes(c)) existing.classes.push(c);
        }
      } else {
        productMap.set(product.productId, {
          productId: product.productId,
          displayName: product.displayName,
          classes: [...new Set(product.classes)],
          applicationCount: 1,
          acresTreated: acres
        });
      }
      for (const c of product.classes) classesThisApp.add(c);
    }
    for (const className of classesThisApp) {
      const existing = classMap.get(className);
      if (existing) {
        existing.applicationCount += 1;
        existing.acresTreated += acres;
      } else {
        classMap.set(className, { className, applicationCount: 1, acresTreated: acres });
      }
    }

    // Philosophy roll-up: an application is compliant iff every resolved
    // product is allowed; non-compliant iff at least one resolved product
    // is disallowed; unknown when nothing resolves.
    let anyResolved = false;
    let anyDisallowed = false;
    for (const product of app.products) {
      const allowed = input.productAllowed(product.productId);
      if (allowed === undefined) continue;
      anyResolved = true;
      if (!allowed) anyDisallowed = true;
    }
    if (!anyResolved) unknown += 1;
    else if (anyDisallowed) nonCompliant += 1;
    else compliant += 1;
  }

  // Harvest by archetype + moisture stats.
  const archetypeMap = new Map<
    Archetype,
    { cropPluginIds: Set<string>; eventCount: number; moistures: number[] }
  >();
  for (const h of input.harvests) {
    const archetype = input.archetypeForPlugin(h.cropPluginId);
    const bucket = archetypeMap.get(archetype) ?? {
      cropPluginIds: new Set<string>(),
      eventCount: 0,
      moistures: []
    };
    bucket.cropPluginIds.add(h.cropPluginId);
    bucket.eventCount += 1;
    const moisture = parseMoisturePct(h);
    if (moisture !== null) bucket.moistures.push(moisture);
    archetypeMap.set(archetype, bucket);
  }

  const harvestByArchetype: HarvestArchetypeTotal[] = [...archetypeMap.entries()]
    .map(([archetype, b]) => {
      const sampleCount = b.moistures.length;
      const min = sampleCount ? Math.min(...b.moistures) : null;
      const max = sampleCount ? Math.max(...b.moistures) : null;
      const mean = sampleCount
        ? Math.round((b.moistures.reduce((s, x) => s + x, 0) / sampleCount) * 100) / 100
        : null;
      return {
        archetype,
        cropPluginIds: [...b.cropPluginIds].sort(),
        eventCount: b.eventCount,
        cropCount: b.cropPluginIds.size,
        moisture: { sampleCount, min, max, mean }
      };
    })
    .sort((a, b) => b.eventCount - a.eventCount);

  // Input costs from consumption movements × lot cost.
  const inputCosts = computeInputCosts(input.movements);

  // Scout → spray funnel.
  const scoutFunnel = computeScoutFunnel(input.applications, input.scoutObservations);

  // Decon + calibration compliance.
  const yearStartMs = Date.UTC(input.year, 0, 1);
  const yearEndMs = Date.UTC(input.year + 1, 0, 1);
  let calibrated = 0;
  let calibratedThisYear = 0;
  let deconThisYear = 0;
  for (const s of input.sprayers) {
    if (s.calibratedGpa !== null) calibrated += 1;
    if (
      s.calibrationDateMs !== undefined &&
      s.calibrationDateMs >= yearStartMs &&
      s.calibrationDateMs < yearEndMs
    ) {
      calibratedThisYear += 1;
    }
    if (
      s.lastDeconAtMs !== undefined &&
      s.lastDeconAtMs >= yearStartMs &&
      s.lastDeconAtMs < yearEndMs
    ) {
      deconThisYear += 1;
    }
  }

  const totalApplications = herbicide + insecticide + fungicide;

  return {
    year: input.year,
    ownerId: input.ownerId,
    generatedAtMs: input.generatedAtMs,
    totals: {
      sprayApplications: herbicide,
      insecticideApplications: insecticide,
      fungicideApplications: fungicide,
      totalApplications,
      harvestEvents: input.harvests.length,
      blocksTreated: blocksTreated.size
    },
    productAcreage: [...productMap.values()].sort((a, b) => b.acresTreated - a.acresTreated),
    chemistryClassAcreage: [...classMap.values()].sort((a, b) => b.acresTreated - a.acresTreated),
    philosophy: {
      philosophy: input.philosophy,
      totalApplications,
      compliantApplications: compliant,
      nonCompliantApplications: nonCompliant,
      unknownApplications: unknown
    },
    harvestByArchetype,
    inputCosts,
    scoutFunnel,
    compliance: {
      sprayerCount: input.sprayers.length,
      calibratedSprayerCount: calibrated,
      calibratedThisYear,
      deconEventsThisYear: deconThisYear
    }
  };
}

export function computeInputCosts(movements: MovementCostRow[]): {
  lines: InputCostLine[];
  totalCents: number;
} {
  const byCategory = new Map<string, number>();
  for (const m of movements) {
    // Only consumption (negative delta) contributes to cost; receipts and
    // positive adjustments are not spend.
    if (m.deltaHundredths >= 0) continue;
    if (m.lotCostCentsPerUnit === null) continue;
    const units = Math.abs(m.deltaHundredths) / 100;
    const cents = Math.round(units * m.lotCostCentsPerUnit);
    byCategory.set(m.category, (byCategory.get(m.category) ?? 0) + cents);
  }
  const lines = [...byCategory.entries()]
    .map(([category, costCents]) => ({ category, costCents }))
    .sort((a, b) => b.costCents - a.costCents);
  return { lines, totalCents: lines.reduce((s, l) => s + l.costCents, 0) };
}

export function computeScoutFunnel(
  applications: SprayApplicationRow[],
  scoutObservations: Array<ScoutRow>
): ScoutFunnel {
  // Applications that fired on an at-or-over-threshold observation.
  let thresholdTriggered = 0;
  for (const app of applications) {
    const obs = app.observation;
    if (obs && obs.threshold !== undefined && obs.value >= obs.threshold) {
      thresholdTriggered += 1;
    }
  }

  // Sprays avoided: an observation whose block saw no follow-up application
  // within the window. Any pesticide application (herbicide / insecticide /
  // fungicide) counts as the "a spray followed" signal.
  const appsByBlock = new Map<string, number[]>();
  for (const app of applications) {
    const list = appsByBlock.get(app.blockId) ?? [];
    list.push(app.occurredAtMs);
    appsByBlock.set(app.blockId, list);
  }
  let avoided = 0;
  for (const obs of scoutObservations) {
    const blockApps = appsByBlock.get(obs.blockId) ?? [];
    const followed = blockApps.some(
      (t) => t >= obs.occurredAtMs && t <= obs.occurredAtMs + SCOUT_FOLLOWUP_MS
    );
    if (!followed) avoided += 1;
  }

  return {
    scoutObservations: scoutObservations.length,
    thresholdTriggeredApplications: thresholdTriggered,
    spraysAvoided: avoided
  };
}

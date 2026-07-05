/**
 * UC-46 — Year-end summary orchestrator (server-only).
 *
 * Pulls a single (owner, year) of operational rows through the
 * tenant-scoped repos (Invariant 6 — every read funnels through
 * `withTenant`), resolves the plugin registry + Season Setup philosophy,
 * and delegates the fold to the pure `computeYearSummary`.
 *
 * Read-only: no migration, no writes. See `yearSummary.ts` for the shape.
 */

import { and, eq, gte, lt } from 'drizzle-orm';

import { db } from '$lib/db/client';
import { stockItems, stockLots, stockMovements } from '$lib/db/schema';
import { withTenant } from '$lib/db/tenant';
import { listBlocks } from '$lib/db/blocks';
import { listSprayers } from '$lib/db/sprayers';
import { listSprayEvents } from '$lib/db/sprayEvents';
import { listInsecticideEvents } from '$lib/db/insecticideEvents';
import { listFungicideEvents } from '$lib/db/fungicideEvents';
import { listHarvestEvents } from '$lib/db/harvestEvents';
import { listScoutObservations } from '$lib/db/scoutObservations';
import { getRegistry } from '$lib/server/registry';
import { loadSeasonSetup } from '$lib/season/setup.server';
import { DEFAULT_SEASON_SETUP, type Philosophy } from '$lib/season/setup';
import { isProductAllowed, type FilterableInputPlugin } from '$lib/season/philosophyFilter';
import { resolveArchetype, type Archetype, type CropPlugin } from '$lib/plugins/schemas';

import {
  computeYearSummary,
  type MovementCostRow,
  type SprayApplicationRow,
  type YearSummary
} from './yearSummary';

const FILTERABLE_PLUGIN_TYPES = new Set(['herbicide', 'insecticide', 'fungicide', 'fertilizer']);

/** Year bounds in *local* time — the same wall-clock a farmer thinks of a
 *  season in. Occurred timestamps are ms epoch. */
function yearBounds(year: number): { fromMs: number; toMs: number } {
  return {
    fromMs: new Date(year, 0, 1, 0, 0, 0, 0).getTime(),
    toMs: new Date(year + 1, 0, 1, 0, 0, 0, 0).getTime() - 1
  };
}

/** Cost, in cents per whole default-unit, for a lot. `receivedCostCents` is
 *  the total cost of the received quantity; divide by that quantity to get a
 *  per-unit rate the consumption movements can be priced against. */
function lotCostCentsPerUnit(
  receivedCostCents: number | null,
  receivedQuantityHundredths: number
): number | null {
  if (receivedCostCents === null || receivedQuantityHundredths <= 0) return null;
  const units = receivedQuantityHundredths / 100;
  return receivedCostCents / units;
}

/** Consumption-movement rows for a year, joined to their lot's cost + the
 *  parent item's category. Tenant-scoped on all three tables. */
function movementCostRows(fromMs: number, toMs: number): MovementCostRow[] {
  const rows = db
    .select({
      category: stockItems.category,
      deltaHundredths: stockMovements.deltaHundredths,
      reason: stockMovements.reason,
      receivedCostCents: stockLots.receivedCostCents,
      receivedQuantityHundredths: stockLots.receivedQuantityHundredths
    })
    .from(stockMovements)
    .innerJoin(stockLots, and(eq(stockMovements.stockLotId, stockLots.id), withTenant(stockLots)))
    .innerJoin(stockItems, and(eq(stockLots.stockItemId, stockItems.id), withTenant(stockItems)))
    .where(
      withTenant(
        stockMovements,
        and(
          gte(stockMovements.occurredAt, new Date(fromMs)),
          lt(stockMovements.occurredAt, new Date(toMs + 1))
        )
      )
    )
    .all();

  return rows.map((r) => ({
    category: r.category,
    deltaHundredths: r.deltaHundredths,
    reason: r.reason,
    lotCostCentsPerUnit: lotCostCentsPerUnit(r.receivedCostCents, r.receivedQuantityHundredths)
  }));
}

/**
 * Build the deterministic Year-end summary for the active tenant + year.
 * Everything here is a tenant-scoped read; there is no write path.
 */
export async function buildYearSummary(year: number, ownerId: string | null): Promise<YearSummary> {
  const { fromMs, toMs } = yearBounds(year);

  const sprayEvents = listSprayEvents({ fromMs, toMs, limit: 100_000 });
  const insecticideEvents = listInsecticideEvents({ fromMs, toMs, limit: 100_000 });
  const fungicideEvents = listFungicideEvents({ fromMs, toMs, limit: 100_000 });
  const harvestEvents = listHarvestEvents({ fromMs, toMs });
  const scoutObs = listScoutObservations({ fromMs, limit: 100_000 }).filter(
    (o) => o.occurredAt >= fromMs && o.occurredAt <= toMs
  );
  const blocks = listBlocks();
  const sprayers = listSprayers();
  const registry = await getRegistry();

  const philosophy: Philosophy =
    loadSeasonSetup(year)?.philosophy ?? DEFAULT_SEASON_SETUP.philosophy;

  // ── Applications (herbicide + insecticide + fungicide), normalized. ──
  const applications: SprayApplicationRow[] = [];

  for (const e of sprayEvents) {
    applications.push({
      kind: 'herbicide',
      blockId: e.blockId,
      occurredAtMs: e.occurredAt,
      products: e.products.map((p) => ({
        productId: p.pluginId,
        displayName: p.pluginId,
        classes: p.chemistryClasses ?? []
      }))
    });
  }
  for (const e of insecticideEvents) {
    applications.push({
      kind: 'insecticide',
      blockId: e.blockId,
      occurredAtMs: e.occurredAt,
      products: e.products.map((p) => ({
        productId: p.pluginId,
        displayName: p.displayName ?? p.pluginId,
        classes: p.iracGroups ?? []
      })),
      observation: e.scoutObservation
        ? { value: e.scoutObservation.value, threshold: e.scoutObservation.threshold }
        : undefined
    });
  }
  for (const e of fungicideEvents) {
    applications.push({
      kind: 'fungicide',
      blockId: e.blockId,
      occurredAtMs: e.occurredAt,
      products: e.products.map((p) => ({
        productId: p.pluginId,
        displayName: p.displayName ?? p.pluginId,
        classes: p.fracCodes ?? []
      })),
      observation: e.diseaseObservation
        ? { value: e.diseaseObservation.value, threshold: e.diseaseObservation.threshold }
        : undefined
    });
  }

  const acresByBlock = new Map(blocks.map((b) => [b.id, b.acres ?? 0]));

  return computeYearSummary({
    year,
    ownerId,
    generatedAtMs: Date.now(),
    philosophy,
    applications,
    harvests: harvestEvents.map((h) => ({
      cropPluginId: h.cropPluginId,
      occurredAtMs: h.occurredAt,
      quantity: h.quantity,
      lotNumber: h.lotNumber
    })),
    scoutObservations: scoutObs.map((o) => ({
      blockId: o.blockId,
      occurredAtMs: o.occurredAt,
      value: o.value
    })),
    movements: movementCostRows(fromMs, toMs),
    sprayers: sprayers.map((s) => ({
      calibratedGpa: s.calibratedGpa,
      calibrationDateMs: s.calibrationDate,
      lastDeconAtMs: s.lastDeconAt
    })),
    acresForBlock: (blockId) => acresByBlock.get(blockId) ?? 0,
    archetypeForPlugin: (cropPluginId) => archetypeForPlugin(registry, cropPluginId),
    productAllowed: (productId) => productAllowedUnder(registry, productId, philosophy)
  });
}

function archetypeForPlugin(
  registry: Awaited<ReturnType<typeof getRegistry>>,
  cropPluginId: string
): Archetype {
  const rec = registry.get(cropPluginId);
  if (!rec || rec.plugin.type !== 'crop') {
    return resolveArchetype({});
  }
  const crop = rec.plugin as CropPlugin;
  return resolveArchetype({
    archetype: crop.archetype,
    harvestStyle: crop.harvestStyle,
    cropFamily: crop.cropFamily
  });
}

function productAllowedUnder(
  registry: Awaited<ReturnType<typeof getRegistry>>,
  productId: string,
  philosophy: Philosophy
): boolean | undefined {
  const rec = registry.get(productId);
  if (!rec) return undefined;
  if (!FILTERABLE_PLUGIN_TYPES.has(rec.plugin.type)) return undefined;
  return isProductAllowed(rec.plugin as FilterableInputPlugin, philosophy);
}

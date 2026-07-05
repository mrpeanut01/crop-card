/**
 * POST /api/spray/record
 *
 * The persistence-side gate (FR-09, NFR-07). Re-runs the safety kernel
 * server-side regardless of the client's prior call, then writes the event
 * to spray_events. Updates sprayer state so the cross-contamination gate
 * is correct on the next spray.
 *
 * Refuses to commit if the kernel says ok=false. Helper-role tampering or
 * client-side bypass cannot reach the database.
 */

import { json, type RequestHandler } from '@sveltejs/kit';
import { z } from 'zod';
import { computeTankMixDilutions } from '$lib/dilution/calculator';
import { insertSprayEvent } from '$lib/db/sprayEvents';
import {
  decrementForUse,
  getStockItem,
  getStockItemByPluginId,
  type DecrementResult,
  type StockItem
} from '$lib/db/stock';
import { ensureSystemUser } from '$lib/db/users';
import type { HerbicidePlugin } from '$lib/plugins/schemas';
import { CROP_FAMILIES } from '$lib/safety/cropFamilyLethality';
import {
  evaluateSpray,
  RULES_VERSION,
  type ChemistryClass,
  type HerbicideProduct,
  type SprayContext
} from '$lib/safety';
import { augmentSafetyResult } from '$lib/safety/userAddedRestrictions';
import {
  buildRestrictionsFromStockItems,
  type StockPluginPair
} from '$lib/safety/userAddedRestrictionsFromStock';
import type { StockUnit } from '$lib/stock/units';
import { currentUser } from '$lib/server/auth';
import { canMutate } from '$lib/server/session';
import { getRegistry } from '$lib/server/registry';
import { getSprayer, recordSpray } from '$lib/server/sprayers';
import { checkSeasonClosed } from '$lib/server/seasonClose';

const cropStageInput = z.object({
  cropPluginId: z.string().min(1),
  cropFamily: z.enum(CROP_FAMILIES).optional(),
  heightInches: z.number().nonnegative().optional()
});

const requestSchema = z.object({
  blockId: z.string().min(1),
  /** Phase 12: per-crop attribution. When supplied, the spray_event row
   *  carries crop_id; if a `taskId` is also supplied, that primary task
   *  is marked complete on success. */
  cropId: z.string().optional(),
  taskId: z.string().optional(),
  occurredAt: z.number().int().optional(),
  blockCrops: z.object({
    primary: cropStageInput,
    coPlanted: z.array(cropStageInput).optional()
  }),
  productPluginIds: z.array(z.string().min(1)).min(1),
  /** Phase 17 (Track 2.4) — parallel to productPluginIds. When supplied, the
   *  named stock items feed the safety augmenter; missing entries fall back
   *  to lookup by pluginId. */
  stockItemIds: z.array(z.string().min(1).nullable()).optional(),
  sprayer: z.object({ id: z.string().min(1) }),
  conditions: z.object({
    windMph: z.number().nonnegative(),
    tempF: z.number(),
    rainForecastMmNext24h: z.number().nonnegative(),
    /** #320 / CT-S5-003 — honest audit trail. When the client omits this
     *  (or the operator never entered readings) we persist `'default'`
     *  so a synthetic 5 mph / 70 °F is never presented as measured. */
    conditionsProvenance: z.enum(['measured', 'default']).optional()
  }),
  /** Tank size for auto-decrement; if omitted, no stock decrement happens. */
  tankSizeGallons: z.number().positive().optional(),
  customRateOverride: z.boolean().optional(),
  notes: z.string().max(500).optional()
});

export const POST: RequestHandler = async (event) => {
  const { request } = event;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'invalid JSON body' }, { status: 400 });
  }

  const parsed = requestSchema.safeParse(body);
  if (!parsed.success) {
    return json(
      {
        error: 'invalid request',
        issues: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message }))
      },
      { status: 400 }
    );
  }

  const registry = await getRegistry();
  const occurredAt = parsed.data.occurredAt ?? Date.now();

  // UC-44 — SEASON_CLOSED gate. Refuse writes dated inside a closed season.
  const seasonClosed = checkSeasonClosed(occurredAt);
  if (seasonClosed) {
    return json(
      { error: seasonClosed.code, message: seasonClosed.message, year: seasonClosed.year },
      { status: 422 }
    );
  }

  const products: HerbicideProduct[] = [];
  const fullProducts: HerbicidePlugin[] = [];
  const pluginHashes: Record<string, string> = {};
  const missing: string[] = [];

  for (const id of parsed.data.productPluginIds) {
    const record = registry.get(id);
    if (!record || record.plugin.type !== 'herbicide') {
      missing.push(id);
      continue;
    }
    fullProducts.push(record.plugin);
    products.push({
      pluginId: record.plugin.pluginId,
      displayName: record.plugin.displayName,
      activeIngredients: record.plugin.activeIngredients,
      labelClaims: record.plugin.labelClaims,
      traitGatedSafeFor: record.plugin.traitGatedSafeFor
    });
    pluginHashes[id] = record.hash;
  }

  if (missing.length > 0) {
    return json({ error: 'unknown herbicide pluginIds', missing }, { status: 404 });
  }

  const stored = getSprayer(parsed.data.sprayer.id);
  if (!stored) {
    return json({ error: `unknown sprayer: ${parsed.data.sprayer.id}` }, { status: 404 });
  }

  // Role gates (FR-09 / NFR-09).
  const auth = currentUser(event);
  if (auth && !canMutate(auth.role)) {
    return json({ error: 'inspector role is read-only' }, { status: 403 });
  }
  if (parsed.data.customRateOverride && auth?.role !== 'owner') {
    return json({ error: 'custom rate override requires owner role' }, { status: 403 });
  }

  const enrichCrop = (c: z.infer<typeof cropStageInput>) => ({
    ...c,
    cropFamily: c.cropFamily ?? registry.cropFamilyOf(c.cropPluginId),
    traits: registry.cropTraitsOf(c.cropPluginId)
  });

  const ctx: SprayContext = {
    occurredAt,
    products,
    crop: enrichCrop(parsed.data.blockCrops.primary),
    coPlantedCrops: parsed.data.blockCrops.coPlanted?.map(enrichCrop),
    sprayer: {
      id: stored.id,
      lastChemistryClass: stored.lastChemistryClass,
      lastSprayedAt: stored.lastSprayedAt,
      lastDeconAt: stored.lastDeconAt
    },
    conditions: {
      windMph: parsed.data.conditions.windMph,
      tempF: parsed.data.conditions.tempF,
      rainForecastMmNext24h: parsed.data.conditions.rainForecastMmNext24h
    }
  };

  const kernelResult = evaluateSpray(ctx);

  // Resolve stock items once: explicit ids first, then pluginId lookup. The
  // map is also reused below for auto-decrement so we hit the DB once per item.
  const stockByPluginId = new Map<string, StockItem>();
  const stockPairs: StockPluginPair[] = [];
  for (let i = 0; i < fullProducts.length; i++) {
    const plugin = fullProducts[i];
    const explicitId = parsed.data.stockItemIds?.[i] ?? undefined;
    const stockItem = explicitId
      ? getStockItem(explicitId)
      : getStockItemByPluginId(plugin.pluginId);
    if (!stockItem) continue;
    stockByPluginId.set(plugin.pluginId, stockItem);
    if (stockItem.activeIngredientsJson) {
      stockPairs.push({
        stockItem,
        plugin: {
          pluginId: plugin.pluginId,
          displayName: plugin.displayName,
          activeIngredients: plugin.activeIngredients
        }
      });
    }
  }

  const kernel = augmentSafetyResult(
    kernelResult,
    ctx,
    buildRestrictionsFromStockItems(stockPairs)
  );
  if (!kernel.ok) {
    return json(
      {
        error: 'kernel rejected spray; refusing to persist',
        ...kernel,
        ruleVersion: RULES_VERSION
      },
      { status: 422 }
    );
  }

  // Use the signed-in user as performer; fall back to system if unauthenticated.
  const performer = auth ?? (await ensureSystemUser());

  // Persist event (`event` is the request context; use a separate name).
  const persisted = insertSprayEvent({
    blockId: parsed.data.blockId,
    cropId: parsed.data.cropId,
    sprayerId: stored.id,
    performedById: performer.id,
    occurredAt,
    products: fullProducts.map((p) => ({
      pluginId: p.pluginId,
      chemistryClasses: Array.from(new Set(p.activeIngredients.map((ai) => ai.chemistryClass))),
      rate: p.ratePerAcre
    })),
    conditions: {
      ...parsed.data.conditions,
      // #320 — never let a synthetic reading masquerade as measured. A
      // client that omits the flag gets `'default'`; the UI sets
      // `'measured'` only once the operator enters real conditions.
      conditionsProvenance: parsed.data.conditions.conditionsProvenance ?? 'default'
    },
    rulesVersion: RULES_VERSION,
    pluginHashes,
    customRateOverride: parsed.data.customRateOverride ?? false,
    notes: parsed.data.notes
  });

  // Update sprayer chemistry history (most-aggressive class wins on the kernel's
  // future evaluations; we record the union below as a sequence of updates).
  const newClasses: ChemistryClass[] = Array.from(
    new Set(fullProducts.flatMap((p) => p.activeIngredients.map((ai) => ai.chemistryClass)))
  );
  for (const cls of newClasses) recordSpray(stored.id, cls, occurredAt);

  // Auto-decrement stock from the dilution math (Phase 8b). Warn-don't-block
  // policy: shortfalls are surfaced in the response but don't cancel the
  // spray record (the product is already in the tank; refusing the record
  // would create a worse audit gap than letting the negative balance
  // persist for reconciliation on /stock).
  const stockResults: DecrementResult[] = [];
  const stockWarnings: string[] = [];
  if (parsed.data.tankSizeGallons) {
    // #190 / F-02 — stored.calibratedGpa may be null on an uncalibrated
    // sprayer; coalesce so computeTankMixDilutions falls back to the
    // herbicide-plugin GPA default rather than treating null as 0.
    const effectiveGpa = stored?.calibratedGpa ?? undefined;
    const lines = computeTankMixDilutions(fullProducts, parsed.data.tankSizeGallons, effectiveGpa);
    for (const line of lines) {
      const stockItem = stockByPluginId.get(line.pluginId);
      if (!stockItem) {
        stockWarnings.push(
          `${line.pluginId}: not tracked in stock — add a SKU on /inventory to enable auto-decrement`
        );
        continue;
      }
      try {
        const result = decrementForUse({
          stockItemId: stockItem.id,
          amount: line.productAmount,
          unit: line.unit as StockUnit,
          sprayEventId: persisted.id,
          performedById: performer.id,
          occurredAt
        });
        stockResults.push(result);
        for (const note of result.notes) stockWarnings.push(`${line.pluginId}: ${note}`);
      } catch (e) {
        stockWarnings.push(
          `${line.pluginId}: stock decrement failed — ${e instanceof Error ? e.message : String(e)}`
        );
      }
    }
  }

  // Phase 12: close the originating primary task if the caller passed one.
  if (parsed.data.taskId) {
    try {
      const { completeTask } = await import('$lib/db/tasks');
      completeTask(parsed.data.taskId, {
        eventTable: 'spray_event',
        eventId: persisted.id,
        occurredAt
      });
    } catch (e) {
      // Non-fatal — log and continue. The spray was recorded; the task can
      // be closed manually on /today if this fails.
      stockWarnings.push(
        `task ${parsed.data.taskId} not closed: ${e instanceof Error ? e.message : String(e)}`
      );
    }
  }

  return json({
    event: persisted,
    ruleVersion: RULES_VERSION,
    stockDecrements: stockResults,
    stockWarnings
  });
};

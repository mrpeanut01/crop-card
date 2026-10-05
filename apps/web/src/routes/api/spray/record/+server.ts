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

import { withClientRecordId } from '$lib/server/clientRecordId';
import { closeTaskForRecord } from '$lib/server/recordTaskClose';
import { json, type RequestHandler } from '@sveltejs/kit';
import { z } from 'zod';
import { sprayCropStageSchema, sprayRecordSchema } from '$lib/records/apiSchemas';
import { computeTankMixDilutions } from '$lib/dilution/calculator';
import { getBlock } from '$lib/db/blocks';
import { getCrop } from '$lib/db/crops';
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
import { rejectForeignRefs } from '$lib/server/foreignRefs';
import { bestEffort, errorText } from '$lib/server/recordWrite';
import { tryGuardedHoldWrite } from '$lib/server/holdGuard';

export const _requestSchema = sprayRecordSchema;
const requestSchema = sprayRecordSchema;

export const POST: RequestHandler = withClientRecordId(async (event) => {
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

  const foreign = rejectForeignRefs(
    ['blockId', parsed.data.blockId, getBlock],
    ['cropId', parsed.data.cropId, getCrop]
  );
  if (foreign) return foreign;

  const registry = await getRegistry();
  const occurredAt = parsed.data.occurredAt ?? Date.now();

  // UC-44 — SEASON_CLOSED gate. Refuse writes dated inside a closed season.
  const seasonClosed = checkSeasonClosed(occurredAt, event.locals?.locale);
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

  const enrichCrop = (c: z.infer<typeof sprayCropStageSchema>) => ({
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

  // One transaction: record, sprayer state, stock movements, task close and
  // the replay receipt commit together or not at all.
  const guarded = await tryGuardedHoldWrite(
    event,
    auth,
    () => {
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
        const lines = computeTankMixDilutions(
          fullProducts,
          parsed.data.tankSizeGallons,
          effectiveGpa
        );
        for (const line of lines) {
          const stockItem = stockByPluginId.get(line.pluginId);
          if (!stockItem) {
            stockWarnings.push(
              `${line.pluginId}: not tracked in stock — add a SKU on /inventory to enable auto-decrement`
            );
            continue;
          }
          const dec = bestEffort(() =>
            decrementForUse({
              stockItemId: stockItem.id,
              amount: line.productAmount,
              unit: line.unit as StockUnit,
              sprayEventId: persisted.id,
              performedById: performer.id,
              occurredAt
            })
          );
          if (dec.ok) {
            stockResults.push(dec.value);
            for (const note of dec.value.notes) stockWarnings.push(`${line.pluginId}: ${note}`);
          } else {
            stockWarnings.push(
              `${line.pluginId}: stock decrement failed — ${errorText(dec.error)}`
            );
          }
        }
      }

      const taskClose = closeTaskForRecord({
        taskId: parsed.data.taskId,
        record: { blockId: parsed.data.blockId, cropId: parsed.data.cropId },
        eventTable: 'spray_event',
        eventId: persisted.id,
        occurredAt
      });
      if (taskClose?.status === 'failed') {
        stockWarnings.push(`task ${taskClose.taskId} not closed`);
      }
      return { persisted, stockResults, stockWarnings, taskClose };
    },
    { dated: true }
  );
  if (!guarded.ok) return guarded.response;
  const { persisted, stockResults, stockWarnings, taskClose } = guarded.value;

  return json({
    event: persisted,
    ruleVersion: RULES_VERSION,
    stockDecrements: stockResults,
    stockWarnings,
    taskClose
  });
});

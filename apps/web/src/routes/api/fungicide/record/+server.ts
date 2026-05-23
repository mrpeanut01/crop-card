/**
 * POST /api/fungicide/record
 *
 * Persistence-side fungicide gate (Phase 21 / B-18 / UC-37d). Mirrors
 * `/api/insecticide/record` field-for-field — re-runs environmental
 * gates via the safety kernel, computes REI / PHI clear-by timestamps
 * from the plugin, auto-decrements stock when a tank size is supplied.
 *
 * Differences from the insecticide endpoint: products carry FRAC codes
 * (Fungicide Resistance Action Committee) instead of IRAC groups; the
 * scout payload is `disease` rather than `pest` semantics; PHI windows
 * are typically much longer (14–21d vs 0–7d) but the math is identical.
 */

import { json, type RequestHandler } from '@sveltejs/kit';
import { z } from 'zod';
import { computeRatedDilution } from '$lib/dilution/calculator';
import { insertFungicideEvent, type DiseaseObservation } from '$lib/db/fungicideEvents';
import {
  decrementForUse,
  getStockItem,
  getStockItemByPluginId,
  type DecrementResult,
  type StockItem
} from '$lib/db/stock';
import { ensureSystemUser } from '$lib/db/users';
import type { FungicidePlugin } from '$lib/plugins/schemas';
import { checkEnvironment } from '$lib/safety/environment';
import type { HerbicideProduct, SafetyResult, SprayContext } from '$lib/safety';
import { augmentSafetyResult } from '$lib/safety/userAddedRestrictions';
import {
  buildRestrictionsFromStockItems,
  type StockPluginPair
} from '$lib/safety/userAddedRestrictionsFromStock';
import { RULES_VERSION } from '$lib/safety/version';
import type { StockUnit } from '$lib/stock/units';
import { currentUser } from '$lib/server/auth';
import { canMutate } from '$lib/server/session';
import { getRegistry } from '$lib/server/registry';

const requestSchema = z.object({
  blockId: z.string().min(1),
  cropId: z.string().optional(),
  taskId: z.string().optional(),
  occurredAt: z.number().int().optional(),
  productPluginIds: z.array(z.string().min(1)).min(1),
  stockItemIds: z.array(z.string().min(1).nullable()).optional(),
  sprayerId: z.string().min(1).optional(),
  conditions: z.object({
    windMph: z.number().nonnegative(),
    tempF: z.number(),
    rainForecastMmNext24h: z.number().nonnegative()
  }),
  disease: z
    .object({
      disease: z.string().min(1),
      metric: z.string().min(1),
      value: z.number().nonnegative(),
      threshold: z.number().nonnegative().optional(),
      notes: z.string().max(500).optional()
    })
    .optional(),
  tankSizeGallons: z.number().positive().optional()
});

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

export const POST: RequestHandler = async (event) => {
  const auth = currentUser(event);
  if (auth && !canMutate(auth.role)) {
    return json({ error: 'inspector role is read-only' }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await event.request.json();
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

  const products: FungicidePlugin[] = [];
  const pluginHashes: Record<string, string> = {};
  const missing: string[] = [];

  for (const id of parsed.data.productPluginIds) {
    const record = registry.get(id);
    if (!record || record.plugin.type !== 'fungicide') {
      missing.push(id);
      continue;
    }
    products.push(record.plugin);
    pluginHashes[id] = record.hash;
  }

  if (missing.length > 0) {
    return json({ error: 'unknown fungicide pluginIds', missing }, { status: 404 });
  }

  const envViolations = checkEnvironment(parsed.data.conditions);
  if (envViolations.length > 0) {
    return json(
      {
        error: 'environmental conditions failed',
        violations: envViolations,
        ruleVersion: RULES_VERSION
      },
      { status: 422 }
    );
  }

  const stockByPluginId = new Map<string, StockItem>();
  const stockPairs: StockPluginPair[] = [];
  for (let i = 0; i < products.length; i++) {
    const plugin = products[i];
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
          activeIngredients: plugin.activeIngredients.map((ai) => ({ name: ai.name }))
        }
      });
    }
  }

  if (stockPairs.length > 0) {
    const augmenterCtx: SprayContext = {
      occurredAt,
      products: products.map(
        (p) =>
          ({
            pluginId: p.pluginId,
            displayName: p.displayName,
            activeIngredients: []
          }) as HerbicideProduct
      ),
      crop: { cropPluginId: parsed.data.cropId ?? 'unknown' },
      sprayer: { id: parsed.data.sprayerId ?? 'unknown' },
      conditions: parsed.data.conditions
    };
    const stub: SafetyResult = { ok: true, violations: [], requiresDecon: false };
    const augmented = augmentSafetyResult(
      stub,
      augmenterCtx,
      buildRestrictionsFromStockItems(stockPairs)
    );
    if (!augmented.ok) {
      return json(
        {
          error: 'user-added stock restriction blocks spray; refusing to persist',
          ...augmented,
          ruleVersion: RULES_VERSION
        },
        { status: 422 }
      );
    }
  }

  // Worst-case REI / PHI across the tank. Fungicide PHI is required by
  // the schema (unlike insecticide where it's optional), so the max()
  // is straightforward.
  const reiHours = Math.max(...products.map((p) => p.reEntryIntervalHours));
  const phiDays = Math.max(0, ...products.map((p) => p.preHarvestIntervalDays));
  const reEntryClearAt = occurredAt + reiHours * HOUR_MS;
  const preHarvestClearAt = phiDays > 0 ? occurredAt + phiDays * DAY_MS : undefined;

  const performer = auth ?? (await ensureSystemUser());

  const persisted = insertFungicideEvent({
    blockId: parsed.data.blockId,
    cropId: parsed.data.cropId,
    sprayerId: parsed.data.sprayerId,
    performedById: performer.id,
    occurredAt,
    products: products.map((p) => ({
      pluginId: p.pluginId,
      displayName: p.displayName,
      fracCodes: Array.from(new Set(p.activeIngredients.map((ai) => ai.fracCode))),
      rate: p.ratePerAcre
    })),
    diseaseObservation: parsed.data.disease as DiseaseObservation | undefined,
    conditions: parsed.data.conditions,
    reEntryClearAt,
    preHarvestClearAt,
    rulesVersion: RULES_VERSION,
    pluginHashes
  });

  const stockResults: DecrementResult[] = [];
  const stockWarnings: string[] = [];
  if (parsed.data.tankSizeGallons) {
    for (const p of products) {
      const line = computeRatedDilution(
        {
          pluginId: p.pluginId,
          displayName: p.displayName,
          ratePerAcre: p.ratePerAcre,
          gpaCalibration: p.gpaCalibration ?? 15
        },
        parsed.data.tankSizeGallons
      );
      const stockItem = stockByPluginId.get(p.pluginId);
      if (!stockItem) {
        stockWarnings.push(
          `${p.pluginId}: not tracked in stock — add a SKU on /stock to enable auto-decrement`
        );
        continue;
      }
      try {
        const result = decrementForUse({
          stockItemId: stockItem.id,
          amount: line.productAmount,
          unit: line.unit as StockUnit,
          fungicideEventId: persisted.id,
          performedById: performer.id,
          occurredAt
        });
        stockResults.push(result);
        for (const note of result.notes) stockWarnings.push(`${p.pluginId}: ${note}`);
      } catch (e) {
        stockWarnings.push(
          `${p.pluginId}: stock decrement failed — ${e instanceof Error ? e.message : String(e)}`
        );
      }
    }
  }

  if (parsed.data.taskId) {
    try {
      const { completeTask } = await import('$lib/db/tasks');
      completeTask(parsed.data.taskId, {
        eventTable: 'fungicide_event',
        eventId: persisted.id,
        occurredAt
      });
    } catch (e) {
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

/**
 * POST /api/insecticide/record
 *
 * Persistence-side insecticide gate (Phase 10). Re-runs environmental gates
 * via the safety kernel + computes REI / PHI clear-by timestamps from the
 * plugin so the /today re-entry banner has a fast lookup. Auto-decrements
 * stock when a tank size is supplied (FIFO oldest non-expired lot).
 */

import { json, type RequestHandler } from '@sveltejs/kit';
import { z } from 'zod';
import { computeRatedDilution } from '$lib/dilution/calculator';
import { insertInsecticideEvent, type ScoutObservation } from '$lib/db/insecticideEvents';
import { decrementForUse, getStockItemByPluginId, type DecrementResult } from '$lib/db/stock';
import { ensureSystemUser } from '$lib/db/users';
import type { InsecticidePlugin } from '$lib/plugins/schemas';
import { checkEnvironment } from '$lib/safety/environment';
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
  sprayerId: z.string().min(1).optional(),
  conditions: z.object({
    windMph: z.number().nonnegative(),
    tempF: z.number(),
    rainForecastMmNext24h: z.number().nonnegative()
  }),
  scout: z
    .object({
      pest: z.string().min(1),
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

  const products: InsecticidePlugin[] = [];
  const pluginHashes: Record<string, string> = {};
  const missing: string[] = [];

  for (const id of parsed.data.productPluginIds) {
    const record = registry.get(id);
    if (!record || record.plugin.type !== 'insecticide') {
      missing.push(id);
      continue;
    }
    products.push(record.plugin);
    pluginHashes[id] = record.hash;
  }

  if (missing.length > 0) {
    return json({ error: 'unknown insecticide pluginIds', missing }, { status: 404 });
  }

  // Environmental gate (wind / temp / rain) — same kernel module as herbicides.
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

  // Worst-case REI / PHI across the tank.
  const reiHours = Math.max(...products.map((p) => p.reEntryIntervalHours));
  const phiDays = Math.max(0, ...products.map((p) => p.preHarvestIntervalDays ?? 0));
  const reEntryClearAt = occurredAt + reiHours * HOUR_MS;
  const preHarvestClearAt = phiDays > 0 ? occurredAt + phiDays * DAY_MS : undefined;

  const performer = auth ?? (await ensureSystemUser());

  const persisted = insertInsecticideEvent({
    blockId: parsed.data.blockId,
    cropId: parsed.data.cropId,
    sprayerId: parsed.data.sprayerId,
    performedById: performer.id,
    occurredAt,
    products: products.map((p) => ({
      pluginId: p.pluginId,
      displayName: p.displayName,
      iracGroups: Array.from(new Set(p.activeIngredients.map((ai) => ai.iracGroup ?? 'UN'))),
      rate: p.ratePerAcre
    })),
    scoutObservation: parsed.data.scout as ScoutObservation | undefined,
    conditions: parsed.data.conditions,
    reEntryClearAt,
    preHarvestClearAt,
    rulesVersion: RULES_VERSION,
    pluginHashes
  });

  // Auto-decrement stock (best-effort; warns on shortfall, never blocks).
  const stockResults: DecrementResult[] = [];
  const stockWarnings: string[] = [];
  if (parsed.data.tankSizeGallons) {
    for (const p of products) {
      if (!p.ratePerAcre) continue;
      const line = computeRatedDilution(
        {
          pluginId: p.pluginId,
          displayName: p.displayName,
          ratePerAcre: p.ratePerAcre,
          gpaCalibration: p.gpaCalibration ?? 15
        },
        parsed.data.tankSizeGallons
      );
      const stockItem = getStockItemByPluginId(p.pluginId);
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
          insecticideEventId: persisted.id,
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

  // Phase 12D: close any originating primary task.
  if (parsed.data.taskId) {
    try {
      const { completeTask } = await import('$lib/db/tasks');
      completeTask(parsed.data.taskId, {
        eventTable: 'insecticide_event',
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

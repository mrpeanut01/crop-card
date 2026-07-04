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
import { listFungicideEvents } from '$lib/db/fungicideEvents';
import { getBlock } from '$lib/db/blocks';
import {
  decrementForUse,
  getStockItem,
  getStockItemByPluginId,
  type DecrementResult,
  type StockItem
} from '$lib/db/stock';
import { ensureSystemUser } from '$lib/db/users';
import type { FungicidePlugin, CropPlugin } from '$lib/plugins/schemas';
import { checkEnvironment } from '$lib/safety/environment';
import type { HerbicideProduct, SafetyResult, SprayContext } from '$lib/safety';
import { augmentSafetyResult } from '$lib/safety/userAddedRestrictions';
import {
  buildRestrictionsFromStockItems,
  type StockPluginPair
} from '$lib/safety/userAddedRestrictionsFromStock';
import { RULES_VERSION } from '$lib/safety/version';
import { checkFracRotation } from '$lib/safety/fracRotation';
import { checkFungicideTankMixCompat } from '$lib/safety/fungicideTankMix';
import { checkPollinatorBloom, type CropInBlock } from '$lib/safety/pollinatorBloom';
import { checkCrossContaminationForClasses } from '$lib/safety/crossContamination';
import { runEvaluator } from '$lib/safety/dryRunRunner';
import type { StockUnit } from '$lib/stock/units';
import { currentUser } from '$lib/server/auth';
import { canMutate } from '$lib/server/session';
import { getRegistry } from '$lib/server/registry';
import { getSprayer, recordSpray } from '$lib/server/sprayers';

/** Coarse sprayer-load token for the cross-contamination state machine
 *  (#321). Fungicides carry FRAC codes, not an HRAC ChemistryClass, so the
 *  tank records this category token instead of a per-ingredient class. */
const FUNGICIDE_LOAD_CLASS = 'fungicide-load' as const;

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

  // ─── Phase 25d (#89) — FRAC rotation + pollinator-bloom gates ──────
  // Both evaluators short-circuit through runEvaluator() which respects
  // KERNEL_DRY_RUN; during the 14-day window after 25d ships, violations
  // log to kernel_dry_run_log instead of blocking the spray.

  // Sprint 12 (#194) — copper + sulfur tank-mix is phytotoxic. Hard-gate
  // before any other kernel evaluator so the operator sees the precise
  // chemistry-pair reason rather than a generic "FRAC overlap".
  const tankMixIssues = checkFungicideTankMixCompat(
    products.map((p) => ({
      pluginId: p.pluginId,
      displayName: p.displayName,
      fracCodes: Array.from(new Set(p.activeIngredients.map((ai) => ai.fracCode)))
    }))
  );
  const incompatIssues = tankMixIssues.filter((i) => i.severity === 'incompatible');
  if (incompatIssues.length > 0) {
    return json(
      {
        error: 'tank-mix incompatibility',
        violations: incompatIssues.map((i) => ({
          code: i.code,
          message: i.message,
          detail: { productPluginIds: i.productPluginIds }
        })),
        ruleVersion: RULES_VERSION
      },
      { status: 422 }
    );
  }

  const fracProposed = products.map((p) => ({
    pluginId: p.pluginId,
    fracCodes: Array.from(new Set(p.activeIngredients.map((ai) => ai.fracCode)))
  }));
  const priorFungOnBlock = listFungicideEvents({
    blockId: parsed.data.blockId,
    limit: 20
  }).map((e) => ({
    pluginId: e.products[0]?.pluginId ?? 'unknown',
    fracCodes: e.products.flatMap((p) => p.fracCodes ?? []),
    occurredAt: e.occurredAt
  }));
  const fracViolations = runEvaluator(
    'fracRotation',
    () => checkFracRotation(fracProposed, priorFungOnBlock),
    {
      plannedSpray: { productPluginIds: parsed.data.productPluginIds },
      blockId: parsed.data.blockId
    }
  );

  const block = getBlock(parsed.data.blockId);
  const cropsInBlock: CropInBlock[] = (block?.plantings ?? [])
    .filter((p): p is typeof p & { plantingDate: number } => p.plantingDate != null)
    .map((p) => {
      const rec = registry.get(p.cropPluginId);
      const cropPlugin: CropPlugin | null =
        rec && rec.plugin.type === 'crop' ? (rec.plugin as CropPlugin) : null;
      return {
        cropPluginId: p.cropPluginId,
        plantedAt: p.plantingDate,
        bloomWindow: cropPlugin?.bloomWindow
      };
    });
  const pollinatorViolations = runEvaluator(
    'pollinatorBloom',
    () =>
      checkPollinatorBloom(
        products.map((p) => ({
          pluginId: p.pluginId,
          pollinatorRisk: p.pollinatorRisk ?? 'unknown'
        })),
        cropsInBlock,
        occurredAt
      ),
    {
      plannedSpray: { productPluginIds: parsed.data.productPluginIds },
      blockId: parsed.data.blockId
    }
  );

  const gateViolations = [...fracViolations, ...pollinatorViolations];
  if (gateViolations.length > 0) {
    return json(
      {
        error: 'safety-kernel gate(s) failed',
        violations: gateViolations,
        ruleVersion: RULES_VERSION
      },
      { status: 422 }
    );
  }

  // #321 — load the sprayer so the cross-contamination gate and the
  // calibrated-GPA decrement both read real tank state (mirrors the
  // herbicide path). A missing sprayer id is not fatal (the fungicide flow
  // allows unattributed passes); the gate + calibrated GPA no-op then.
  const sprayer = parsed.data.sprayerId ? getSprayer(parsed.data.sprayerId) : undefined;
  if (parsed.data.sprayerId && !sprayer) {
    return json({ error: `unknown sprayer: ${parsed.data.sprayerId}` }, { status: 404 });
  }

  // Cross-contamination gate (UC-04 / UC-32). Copper fungicides in
  // particular carry over and damage the next pass's crop; a different
  // prior chemistry category with no decon since blocks and routes to the
  // decon wizard.
  if (sprayer) {
    const contamination = checkCrossContaminationForClasses([FUNGICIDE_LOAD_CLASS], {
      id: sprayer.id,
      lastChemistryClass: sprayer.lastChemistryClass,
      lastSprayedAt: sprayer.lastSprayedAt,
      lastDeconAt: sprayer.lastDeconAt
    });
    if (contamination.violations.length > 0) {
      return json(
        {
          error: 'cross-contamination gate failed; decon required before this spray',
          violations: contamination.violations,
          requiresDecon: contamination.requiresDecon,
          ruleVersion: RULES_VERSION
        },
        { status: 422 }
      );
    }
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

  // #321 — update sprayer chemistry history so the next different-chemistry
  // pass trips the cross-contamination gate. Mirrors the herbicide path's
  // post-persist recordSpray call.
  if (sprayer) recordSpray(sprayer.id, FUNGICIDE_LOAD_CLASS, occurredAt);

  const stockResults: DecrementResult[] = [];
  const stockWarnings: string[] = [];
  if (parsed.data.tankSizeGallons) {
    // #319 — scale the decrement by the sprayer's stored calibrated GPA, not
    // the plugin default. `computeRatedDilution` coalesces null/undefined
    // calibratedGpa to the plugin's `gpaCalibration` fallback, matching the
    // herbicide path.
    const effectiveGpa = sprayer?.calibratedGpa ?? undefined;
    for (const p of products) {
      const line = computeRatedDilution(
        {
          pluginId: p.pluginId,
          displayName: p.displayName,
          ratePerAcre: p.ratePerAcre,
          gpaCalibration: p.gpaCalibration ?? 15
        },
        parsed.data.tankSizeGallons,
        effectiveGpa
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

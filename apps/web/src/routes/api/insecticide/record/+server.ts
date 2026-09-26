/**
 * POST /api/insecticide/record
 *
 * Persistence-side insecticide gate (Phase 10). Re-runs environmental gates
 * via the safety kernel + computes REI / PHI clear-by timestamps from the
 * plugin so the /today re-entry banner has a fast lookup. Auto-decrements
 * stock when a tank size is supplied (FIFO oldest non-expired lot).
 */

import { withClientRecordId } from '$lib/server/clientRecordId';
import { json, type RequestHandler } from '@sveltejs/kit';
import { z } from 'zod';
import { computeRatedDilution } from '$lib/dilution/calculator';
import {
  insertInsecticideEvent,
  listInsecticideEvents,
  type ScoutObservation as InsectScoutObs
} from '$lib/db/insecticideEvents';
import { listScoutObservations } from '$lib/db/scoutObservations';
import { geometryCentroid, getBlock, listBlocks } from '$lib/db/blocks';
import { getCrop } from '$lib/db/crops';
import {
  decrementForUse,
  getStockItem,
  getStockItemByPluginId,
  type DecrementResult,
  type StockItem
} from '$lib/db/stock';
import { ensureSystemUser } from '$lib/db/users';
import type { InsecticidePlugin, CropPlugin } from '$lib/plugins/schemas';
import { checkEnvironment } from '$lib/safety/environment';
import type { HerbicideProduct, SafetyResult, SprayContext } from '$lib/safety';
import { augmentSafetyResult } from '$lib/safety/userAddedRestrictions';
import {
  buildRestrictionsFromStockItems,
  type StockPluginPair
} from '$lib/safety/userAddedRestrictionsFromStock';
import { RULES_VERSION } from '$lib/safety/version';
import { checkIpmThreshold, type ScoutObservation } from '$lib/safety/ipmThreshold';
import { isInBloom, type CropInBlock } from '$lib/safety/pollinatorBloom';
import {
  checkPollinatorProtection,
  pollinatorViolations,
  type BloomStatus
} from '$lib/safety/pollinatorProtection';
import { sunTimesFor } from '$lib/safety/sunTimes';
import type { AttestedBloomSource } from '$lib/records/pollinatorAttestation';
import { checkNearbyPollinatorBlocks } from '$lib/pollinator/nearbyBlocks';
import { pollinatorNeighbors } from '$lib/server/pollinatorNeighbors';
import { getFarmLatLon } from '$lib/schedule/settings';
import { checkCrossContaminationForClasses } from '$lib/safety/crossContamination';
import { runEvaluator } from '$lib/safety/dryRunRunner';
import type { StockUnit } from '$lib/stock/units';
import { currentUser } from '$lib/server/auth';
import { canMutate } from '$lib/server/session';
import { getRegistry } from '$lib/server/registry';
import { getSprayer, recordSpray } from '$lib/server/sprayers';
import { checkSeasonClosed } from '$lib/server/seasonClose';
import { rejectForeignRefs } from '$lib/server/foreignRefs';

/** Coarse sprayer-load token for the cross-contamination state machine
 *  (#321). Insecticides carry IRAC groups, not an HRAC ChemistryClass, so
 *  the tank records this category token instead of a per-ingredient class. */
const INSECTICIDE_LOAD_CLASS = 'insecticide-load' as const;

const requestSchema = z.object({
  blockId: z.string().min(1),
  cropId: z.string().optional(),
  taskId: z.string().optional(),
  /** Epoch ms the operator recorded the application (stamped client-side,
   *  preserved through the offline queue). The pollinator time-of-day gate
   *  and the stored event time key off this, not server receive time. */
  occurredAt: z.number().int().optional(),
  productPluginIds: z.array(z.string().min(1)).min(1),
  /** Phase 17 (Track 2.4) — parallel to productPluginIds. Feeds the safety
   *  augmenter so operator-confirmed label chemistry can block a spray when
   *  it diverges from the plugin's declared ingredients. */
  stockItemIds: z.array(z.string().min(1).nullable()).optional(),
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
  tankSizeGallons: z.number().positive().optional(),
  /** #130 — operator bloom attestation (crop or flowering weeds). Missing
   *  → derived from crop-plugin bloom windows, else `unknown`. */
  bloomStatus: z.enum(['in-bloom', 'not-in-bloom', 'unknown']).optional(),
  /** #130 — "no bees foraging" attestation; only consulted when sunrise /
   *  sunset cannot be computed for a dusk-to-dawn-only label. */
  attestedNoForagers: z.boolean().optional()
});

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

const OCCURRED_AT_MAX_FUTURE_SKEW_MS = 5 * 60 * 1000;
const OCCURRED_AT_MAX_AGE_MS = 7 * DAY_MS;

/** Bounds a client-supplied application time: no more than a small clock
 *  skew into the future, and no older than the offline-queue horizon. */
function occurredAtError(occurredAt: number, now: number): string | null {
  if (occurredAt > now + OCCURRED_AT_MAX_FUTURE_SKEW_MS) {
    return 'occurredAt is in the future';
  }
  if (occurredAt < now - OCCURRED_AT_MAX_AGE_MS) {
    return 'occurredAt is more than 7 days old';
  }
  return null;
}

export const POST: RequestHandler = withClientRecordId(async (event) => {
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

  const foreign = rejectForeignRefs(
    ['blockId', parsed.data.blockId, getBlock],
    ['cropId', parsed.data.cropId, getCrop]
  );
  if (foreign) return foreign;

  const registry = await getRegistry();
  const now = Date.now();
  if (parsed.data.occurredAt !== undefined) {
    const err = occurredAtError(parsed.data.occurredAt, now);
    if (err) {
      return json(
        { error: 'invalid request', issues: [{ path: 'occurredAt', message: err }] },
        { status: 400 }
      );
    }
  }
  const occurredAt = parsed.data.occurredAt ?? now;

  // UC-44 — SEASON_CLOSED gate. Refuse writes dated inside a closed season.
  const seasonClosed = checkSeasonClosed(occurredAt);
  if (seasonClosed) {
    return json(
      { error: seasonClosed.code, message: seasonClosed.message, year: seasonClosed.year },
      { status: 422 }
    );
  }

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

  // ─── Phase 25d (#89) — IPM threshold + pollinator-bloom gates ──────
  // Both short-circuit through runEvaluator() which respects
  // KERNEL_DRY_RUN; during the 14-day window violations log instead of
  // blocking. Scout observations are read from past insecticide events'
  // scoutObservationJson (no dedicated scout-events table yet — that's a
  // follow-up; see #87 + future scout-table issue). The current-spray
  // scout observation (if the operator entered one) is also included.

  // Phase 25d (#95) — primary path: dedicated scout_observations table.
  // Backfill: legacy embedded payloads from past insecticide events on
  // this block (pre-#95 data). Plus the current spray's scout obs if
  // provided.
  const recentScout: ScoutObservation[] = [];
  for (const o of listScoutObservations({
    blockId: parsed.data.blockId,
    fromMs: occurredAt - 35 * 86_400_000,
    limit: 50
  })) {
    recentScout.push({
      pest: o.pest,
      metric: o.metric,
      value: o.value,
      occurredAt: o.occurredAt
    });
  }
  const priorInsectOnBlock = listInsecticideEvents({
    blockId: parsed.data.blockId,
    limit: 20
  });
  for (const e of priorInsectOnBlock) {
    if (e.scoutObservation) {
      recentScout.push({
        pest: e.scoutObservation.pest,
        metric: e.scoutObservation.metric,
        value: e.scoutObservation.value,
        occurredAt: e.occurredAt
      });
    }
  }
  if (parsed.data.scout) {
    recentScout.push({
      pest: parsed.data.scout.pest,
      metric: parsed.data.scout.metric,
      value: parsed.data.scout.value,
      occurredAt
    });
  }

  const ipmViolations = runEvaluator(
    'ipmThreshold',
    () =>
      checkIpmThreshold(
        products.map((p) => ({
          pluginId: p.pluginId,
          scoutingThresholds: (p.scoutingThresholds ?? []).map((t) => ({
            pest: t.pest,
            metric: t.metric,
            threshold: t.threshold
          }))
        })),
        recentScout
      ),
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
  // #130 — label pollinator gate (RULES_VERSION 0.5.6). Label language is
  // law, so this is not routed through the KERNEL_DRY_RUN wrapper.
  const pluginSaysInBloom = cropsInBlock.some((c) => isInBloom(c, occurredAt));
  const bloomStatus: BloomStatus =
    parsed.data.bloomStatus ?? (pluginSaysInBloom ? 'in-bloom' : 'unknown');
  const bloomStatusSource: AttestedBloomSource = parsed.data.bloomStatus
    ? 'operator'
    : pluginSaysInBloom
      ? 'plugin'
      : 'default';
  const centroid = block?.geometryGeojson ? geometryCentroid(block.geometryGeojson) : null;
  const { lat, lon } = centroid ?? getFarmLatLon();
  const pollinator = checkPollinatorProtection({
    products: products.map((p) => ({
      pluginId: p.pluginId,
      displayName: p.displayName,
      pollinator: p.pollinator,
      pollinatorRisk: p.pollinatorRisk
    })),
    bloomStatus,
    applicationTime: new Date(occurredAt),
    sunTimes: sunTimesFor(lat, lon, new Date(occurredAt)),
    attestedNoForagers: parsed.data.attestedNoForagers
  });
  const pollinatorBlock = pollinatorViolations(pollinator);
  if (pollinatorBlock.length > 0) {
    return json(
      {
        error: 'POLLINATOR_BLOCK',
        code: 'POLLINATOR_BLOCK',
        message: pollinatorBlock[0].message,
        checks: pollinator.checks,
        bloomStatus,
        violations: pollinatorBlock,
        ruleVersion: RULES_VERSION
      },
      { status: 422 }
    );
  }

  // Advisory only (never blocks): bee-toxic product with bloom or
  // bee-attractive plantings on other blocks within foraging range.
  const nearbyPollinator = checkNearbyPollinatorBlocks({
    beeToxicity: pollinator.effective.beeToxicity,
    neighbors: pollinatorNeighbors(
      parsed.data.blockId,
      listBlocks(),
      (id) => {
        const rec = registry.get(id);
        return rec && rec.plugin.type === 'crop' ? (rec.plugin as CropPlugin) : null;
      },
      occurredAt
    )
  });

  const gateViolations = [...ipmViolations];
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
  // herbicide path). A missing sprayer id is not fatal here (the
  // insecticide flow allows unattributed passes); the gate + calibrated
  // GPA simply no-op when no sprayer is selected.
  const sprayer = parsed.data.sprayerId ? getSprayer(parsed.data.sprayerId) : undefined;
  if (parsed.data.sprayerId && !sprayer) {
    return json({ error: `unknown sprayer: ${parsed.data.sprayerId}` }, { status: 404 });
  }

  // Cross-contamination gate (UC-04 / UC-32). If the tank last carried a
  // different chemistry category and no decon has been recorded since,
  // block and route to the decon wizard — same rule the herbicide path
  // runs, now wired into the insecticide flow.
  if (sprayer) {
    const contamination = checkCrossContaminationForClasses([INSECTICIDE_LOAD_CLASS], {
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

  // Phase 17 (Track 2.4) — resolve stock items once for the augmenter + decrement.
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
          // Insecticide ingredients lack a kernel ChemistryClass; the augmenter
          // only reads name + chemistryClass for diff detection and is
          // tolerant of the missing field via the loose PluginIngredientView.
          activeIngredients: plugin.activeIngredients.map((ai) => ({
            name: ai.name
          }))
        }
      });
    }
  }

  if (stockPairs.length > 0) {
    // The augmenter expects a SprayContext. Insecticide products don't carry
    // a kernel ChemistryClass, but our emitted restrictions are universal
    // (empty blocksWhenCropFamily) and key on productPluginId, so cropFamily
    // and chemistry values are not consulted at this call site.
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
    pluginHashes,
    bloomStatus,
    bloomStatusSource,
    attestedNoForagers: parsed.data.attestedNoForagers,
    pollinatorVerdict: pollinator.overall
  });

  // #321 — update sprayer chemistry history so the next different-chemistry
  // pass (e.g. a herbicide after this insecticide) trips the cross-
  // contamination gate. Mirrors the herbicide path's post-persist
  // recordSpray call.
  if (sprayer) recordSpray(sprayer.id, INSECTICIDE_LOAD_CLASS, occurredAt);

  // Auto-decrement stock (best-effort; warns on shortfall, never blocks).
  const stockResults: DecrementResult[] = [];
  const stockWarnings: string[] = [];
  if (parsed.data.tankSizeGallons) {
    // #319 — scale the decrement by the sprayer's stored calibrated GPA, not
    // the plugin default. `computeRatedDilution` coalesces null/undefined
    // calibratedGpa to the plugin's `gpaCalibration` fallback, matching the
    // herbicide path (an 18-GPA rig now decrements ~20% more product).
    const effectiveGpa = sprayer?.calibratedGpa ?? undefined;
    for (const p of products) {
      if (!p.ratePerAcre) continue;
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
          `${p.pluginId}: not tracked in stock — add a SKU on /inventory to enable auto-decrement`
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
    stockWarnings,
    pollinatorWarnings: [
      ...pollinator.checks.filter((c) => c.status === 'warn'),
      ...(nearbyPollinator.status === 'warn' ? [nearbyPollinator] : [])
    ]
  });
});

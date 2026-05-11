/**
 * POST /api/spray/evaluate
 *
 * The server-side gate that the spray-record endpoint must call before
 * persisting any spray event (NFR-07). Mirrors the client-side kernel so
 * tampered clients cannot bypass safety rules.
 *
 * Request body:
 *   {
 *     blockCrops: { primary: { cropPluginId, cropFamily?, heightInches? },
 *                   coPlanted?: [{ cropPluginId, cropFamily? }] },
 *     productPluginIds: ["2-4-d-amine", ...],   // resolved against registry
 *     sprayer: { id, lastChemistryClass?, lastSprayedAt?, lastDeconAt? },
 *     conditions: { windMph, tempF, rainForecastMmNext24h },
 *     occurredAt?: number,
 *     priorApplications?: [{ pluginId, occurredAt }]
 *   }
 *
 * Response: { ok, violations, requiresDecon, ruleVersion, pluginHashes }
 */

import { json, type RequestHandler } from '@sveltejs/kit';
import { z } from 'zod';
import { computeTankMixDilutions, type DilutionLine } from '$lib/dilution/calculator';
import { getStockItem, getStockItemByPluginId, type StockItem } from '$lib/db/stock';
import type { HerbicidePlugin } from '$lib/plugins/schemas';
import { CROP_FAMILIES } from '$lib/safety/cropFamilyLethality';
import {
  buildTankMixSteps,
  evaluateSpray,
  RULES_VERSION,
  type HerbicideProduct,
  type SprayContext,
  type TankMixStep
} from '$lib/safety';
import { augmentSafetyResult } from '$lib/safety/userAddedRestrictions';
import {
  buildRestrictionsFromStockItems,
  type StockPluginPair
} from '$lib/safety/userAddedRestrictionsFromStock';
import { getRegistry } from '$lib/server/registry';
import { getSprayer } from '$lib/server/sprayers';

const cropStageInput = z.object({
  cropPluginId: z.string().min(1),
  cropFamily: z.enum(CROP_FAMILIES).optional(),
  heightInches: z.number().nonnegative().optional(),
  growthStage: z.string().optional()
});

const sprayerInput = z.union([
  z.object({ id: z.string().min(1) }),
  z.object({
    id: z.string().min(1),
    lastChemistryClass: z.string().optional(),
    lastSprayedAt: z.number().int().optional(),
    lastDeconAt: z.number().int().optional()
  })
]);

const requestSchema = z.object({
  occurredAt: z.number().int().optional(),
  blockCrops: z.object({
    primary: cropStageInput,
    coPlanted: z.array(cropStageInput).optional()
  }),
  productPluginIds: z.array(z.string().min(1)).min(1),
  /** Phase 17 (Track 2.4) — when present, stock items are looked up by id
   *  and their `activeIngredientsJson` feeds the safety augmenter so the
   *  kernel verdict reflects operator-confirmed label chemistry. Parallel
   *  array to productPluginIds; missing entries fall back to lookup by
   *  pluginId so existing callers stay compatible. */
  stockItemIds: z.array(z.string().min(1).nullable()).optional(),
  sprayer: sprayerInput,
  /** Optional tank size for dilution math; default 50gal at 15 GPA. */
  tankSizeGallons: z.number().positive().optional(),
  /** Operator-calibrated GPA from FR-12; defaults to plugin gpaCalibration. */
  calibratedGpa: z.number().positive().optional(),
  conditions: z.object({
    windMph: z.number().nonnegative(),
    tempF: z.number(),
    rainForecastMmNext24h: z.number().nonnegative()
  }),
  priorApplications: z
    .array(z.object({ pluginId: z.string().min(1), occurredAt: z.number().int() }))
    .optional()
});

export const POST: RequestHandler = async ({ request }) => {
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

  // Hydrate sprayer state from server when the caller passes just an id;
  // also keep the full record around for things like saved calibrated GPA.
  const stored = getSprayer(parsed.data.sprayer.id);
  let sprayerState: SprayContext['sprayer'];
  if (Object.keys(parsed.data.sprayer).length === 1) {
    sprayerState = stored
      ? {
          id: stored.id,
          lastChemistryClass: stored.lastChemistryClass,
          lastSprayedAt: stored.lastSprayedAt,
          lastDeconAt: stored.lastDeconAt
        }
      : { id: parsed.data.sprayer.id };
  } else {
    sprayerState = parsed.data.sprayer as SprayContext['sprayer'];
  }

  // Fill cropFamily + traits from registry if the caller didn't supply them.
  const enrichCrop = (c: z.infer<typeof cropStageInput>) => ({
    ...c,
    cropFamily: c.cropFamily ?? registry.cropFamilyOf(c.cropPluginId),
    traits: registry.cropTraitsOf(c.cropPluginId)
  });

  const ctx: SprayContext = {
    occurredAt: parsed.data.occurredAt ?? Date.now(),
    products,
    crop: enrichCrop(parsed.data.blockCrops.primary),
    coPlantedCrops: parsed.data.blockCrops.coPlanted?.map(enrichCrop),
    sprayer: sprayerState,
    conditions: parsed.data.conditions
  };

  const kernelResult = evaluateSpray(ctx, {
    priorApplications: parsed.data.priorApplications
  });

  const restrictions = buildRestrictionsFromStockItems(
    resolveStockPluginPairs(fullProducts, parsed.data.stockItemIds)
  );
  const result = augmentSafetyResult(kernelResult, ctx, restrictions);

  let dilutions: DilutionLine[] | undefined;
  let tankMixOrder: TankMixStep[] | undefined;
  if (result.ok) {
    const tankSize = parsed.data.tankSizeGallons ?? 50;
    // Caller-supplied GPA wins; otherwise fall back to the sprayer's saved
    // calibration so spray dilutions reflect real-world rig performance.
    const effectiveGpa = parsed.data.calibratedGpa ?? (stored ? stored.calibratedGpa : undefined);
    dilutions = computeTankMixDilutions(fullProducts, tankSize, effectiveGpa);
    tankMixOrder = buildTankMixSteps(fullProducts);
  }

  return json({
    ...result,
    dilutions,
    tankMixOrder,
    ruleVersion: RULES_VERSION,
    pluginHashes,
    sprayerState
  });
};

function resolveStockPluginPairs(
  plugins: ReadonlyArray<HerbicidePlugin>,
  stockItemIds: ReadonlyArray<string | null> | undefined
): StockPluginPair[] {
  const pairs: StockPluginPair[] = [];
  for (let i = 0; i < plugins.length; i++) {
    const plugin = plugins[i];
    const explicitId = stockItemIds?.[i] ?? undefined;
    const stockItem: StockItem | undefined = explicitId
      ? getStockItem(explicitId)
      : getStockItemByPluginId(plugin.pluginId);
    if (!stockItem?.activeIngredientsJson) continue;
    pairs.push({
      stockItem,
      plugin: {
        pluginId: plugin.pluginId,
        displayName: plugin.displayName,
        activeIngredients: plugin.activeIngredients
      }
    });
  }
  return pairs;
}

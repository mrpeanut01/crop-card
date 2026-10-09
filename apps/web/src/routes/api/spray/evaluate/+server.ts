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
import {
  computeTankMixDilutions,
  productsWithoutRate,
  type DilutionLine
} from '$lib/dilution/calculator';
import { getStockItem, getStockItemByPluginId, type StockItem } from '$lib/db/stock';
import type { HerbicidePlugin } from '$lib/plugins/schemas';
import { cropRateRows, withCropRate, type CropRateRow } from '$lib/plugins/cropRate';
import { cropRateEarlierLabels } from '$lib/server/cropRateSources';
import type { EarlierLabel } from '$lib/plugins/earlierRegistration';
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
import { evaluateSeasonCaps, type SeasonCapVerdict } from '$lib/safety/seasonCap';
import { loadSeasonCapContext } from '$lib/server/seasonCap';
import {
  buildRestrictionsFromStockItems,
  type StockPluginPair
} from '$lib/safety/userAddedRestrictionsFromStock';
import { getRegistry } from '$lib/server/registry';
import { getSprayer } from '$lib/server/sprayers';
import { getBlock, type BlockWithPlantings } from '$lib/db/blocks';
import { resolveSprayCrops, standingCropPluginIds } from '$lib/server/sprayCrops';
import { t } from '$lib/i18n';

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
  /** The block being sprayed: its plantings on file join the crops below. */
  blockId: z.string().min(1).optional(),
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

export const POST: RequestHandler = async ({ request, locals }) => {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: t(locals?.locale, 'stockui.api.invalidJson') }, { status: 400 });
  }

  const parsed = requestSchema.safeParse(body);
  if (!parsed.success) {
    return json(
      {
        error: t(locals?.locale, 'stockui.api.invalidRequest'),
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
    return json(
      { error: t(locals?.locale, 'api.errB.unknownHerbicidePlugins'), missing },
      { status: 404 }
    );
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

  // FR-03: the block's plantings on file join the crops the caller names,
  // and the registry's crop families win over the caller's.
  const occurredAt = parsed.data.occurredAt ?? Date.now();
  let plantings: BlockWithPlantings['plantings'] = [];
  if (parsed.data.blockId) {
    const block = getBlock(parsed.data.blockId);
    if (!block) return json({ error: t(locals?.locale, 'api.errB.unknownBlock') }, { status: 404 });
    plantings = block.plantings;
  }
  const crops = resolveSprayCrops(
    parsed.data.blockCrops,
    standingCropPluginIds(plantings, occurredAt),
    registry
  );

  const ctx: SprayContext = {
    occurredAt,
    products,
    crop: crops.primary,
    coPlantedCrops: crops.coPlanted,
    sprayer: sprayerState,
    conditions: parsed.data.conditions
  };

  // #820: label season caps, counted only when the block is known.
  const sprayedCropIds = [crops.primary, ...crops.coPlanted].map((c) => c.cropPluginId);
  const ratedProducts = fullProducts.map((p) => withCropRate(p, sprayedCropIds));
  const seasonCapCtx = parsed.data.blockId
    ? loadSeasonCapContext({
        blockId: parsed.data.blockId,
        occurredAt,
        cropPluginIds: sprayedCropIds,
        products: ratedProducts
      })
    : null;
  const seasonCaps: SeasonCapVerdict[] = seasonCapCtx ? evaluateSeasonCaps(seasonCapCtx) : [];
  const kernelResult = evaluateSpray(ctx, {
    priorApplications: parsed.data.priorApplications,
    seasonCaps: seasonCapCtx ?? undefined
  });

  const restrictions = buildRestrictionsFromStockItems(
    resolveStockPluginPairs(fullProducts, parsed.data.stockItemIds)
  );
  const result = augmentSafetyResult(kernelResult, ctx, restrictions);

  let dilutions: DilutionLine[] | undefined;
  let noLabelRate: string[] | undefined;
  let tankMixOrder: TankMixStep[] | undefined;
  // #737: label rates and stage limits by crop for the crops on this block.
  const cropLabel: Array<{
    pluginId: string;
    rows: CropRateRow[];
    earlierLabels: EarlierLabel[];
  }> = fullProducts
    .map((p) => ({
      pluginId: p.pluginId,
      earlierLabels: cropRateEarlierLabels(p),
      rows: cropRateRows(p, (id) => registry.get(id)?.plugin.displayName ?? id).filter((r) =>
        sprayedCropIds.includes(r.cropPluginId)
      )
    }))
    .filter((x) => x.rows.length > 0);
  if (result.ok) {
    const tankSize = parsed.data.tankSizeGallons ?? 50;
    // Caller-supplied GPA wins; otherwise fall back to the sprayer's saved
    // calibration so spray dilutions reflect real-world rig performance.
    // #190 / F-02 — stored.calibratedGpa may be null when the sprayer is
    // uncalibrated; coalesce to undefined so computeTankMixDilutions falls
    // back to the herbicide-plugin default rather than treating null as 0.
    const effectiveGpa = parsed.data.calibratedGpa ?? stored?.calibratedGpa ?? undefined;
    dilutions = computeTankMixDilutions(ratedProducts, tankSize, effectiveGpa);
    noLabelRate = productsWithoutRate(ratedProducts);
    tankMixOrder = buildTankMixSteps(fullProducts);
  }

  return json({
    ...result,
    dilutions,
    noLabelRate,
    cropLabel,
    seasonCaps: seasonCaps.map((v) => {
      const plugin = fullProducts.find((p) => p.pluginId === v.pluginId);
      return { ...v, earlierLabels: plugin ? cropRateEarlierLabels(plugin) : [] };
    }),
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

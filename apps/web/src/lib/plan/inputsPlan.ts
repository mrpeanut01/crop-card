/**
 * Deterministic inputs planner (Phase 21 / B-26 / UC-37d).
 *
 * Pure function. Given the wizard's accepted plantings, the season setup,
 * the registered plugin pool, soil tests, fertility credits and current
 * stock, produces an `InputsPlan` describing every recommended product
 * application + scout cadence for the coming year, plus a consolidated
 * shopping list with shortfalls.
 *
 * This is the **source of truth** for the Inputs Plan step. The AI layer
 * (B-27) substitutes products and consolidates tank mixes on top of this
 * output — when the AI fails validation, the wizard falls back to the
 * raw output of this function. So: be conservative, never silently
 * substitute, and emit a warning rather than guessing.
 *
 * Decision sources, in priority order, per applicable slot:
 *
 *   1. Crop plugin's `sprayWindows[]` filtered by `weedStrategyGate` /
 *      `pestStrategyGate` against the season setup tier.
 *   2. Planner-synthesized slots driven by season setup + family defaults:
 *        - pre-plant fertility (always emitted)
 *        - sidedress-N (corn family; brassica heavy feeders)
 *        - cover-crop terminate (when coverCropIntent !== 'none')
 *        - IPM scout cadence (when pestStrategy === 'ipm' or 'minimal')
 *   3. Product choice: first philosophy-allowed plugin in the candidate
 *      pool for the slot's chemistry / category. When none survives, emit
 *      `PlannerWarning { kind: 'no-compliant-product' }` and leave the
 *      slot's product null — the UI surfaces a substitution prompt.
 *
 * Out of scope (intentionally) — these belong to downstream layers:
 *
 *   - Tank-mix consolidation (B-27 AI layer).
 *   - Resistance-group rotation hints (`agronomy/resistance.ts`).
 *   - Live weather / forecast windowing (B-26 emits a date range, the
 *     spray-time flow narrows to today's forecast).
 *   - Sprayer-capacity sizing (`dilution/calculator.ts` runs at spray
 *     execution).
 *
 * Family yield + N/P/K removal estimates are hardcoded in
 * `FAMILY_REMOVAL_DEFAULTS` below. Sourcing: Penn State + UMD Extension
 * small-plot guidelines (Penn State Agronomy Guide 2025; UMD Extension
 * Fact Sheet FS-947 Soil Fertility for Vegetable Production). These are
 * conservative small-plot defaults, not production-row-crop targets.
 *
 * TODO (Phase 22): move yield + removal to optional cropPlugin fields
 * so plugin authors can override family defaults.
 */

import type { Block } from '$lib/db/blocks';
import type { FertilityCredit, SoilTest } from '$lib/db/fertility';
import { toPpm } from '$lib/fertility/soilInterpret';
import type {
  CropPlugin,
  CropSprayWindow,
  FertilizerPlugin,
  FungicidePlugin,
  HerbicidePlugin,
  InsecticidePlugin,
  SprayWindowPurpose
} from '$lib/plugins/schemas';
import type { CropFamily } from '$lib/safety/cropFamilyLethality';
import { isProductAllowed } from '$lib/season/philosophyFilter';
import { effectiveWeedGate, weedStrategyAllows } from '$lib/season/sprayWindowFilter';
import { nCreditForIntent } from '$lib/fertility/coverCropCredits';
import type {
  FertilityApproach,
  PestStrategy,
  Philosophy,
  SeasonSetup,
  WeedStrategy
} from '$lib/season/setup';

import { effectiveAcresFor } from '$lib/db/blocks';
import { checkCropCompatibility } from '$lib/safety/cropCompatibility';
import type { ChemistryClass, HerbicideProduct } from '$lib/safety/types';
import {
  buildShoppingList,
  STOCK_COVERAGE_RANK,
  stockCoverage,
  addStockAmount,
  onHandInUnit,
  takeStockAmount,
  type StockAmount,
  type InputsPlanProductOption,
  type ProductSource
} from './inputsChoice';

export type { InputsPlanProductOption, ProductSource, StockCoverage } from './inputsChoice';

/* ─── Tier comparators ──────────────────────────────────────────────── */

const PEST_TIER: Record<PestStrategy, number> = {
  minimal: 0,
  ipm: 1,
  preventive: 2
};

function pestGateAllows(gate: 'preventive' | 'ipm' | undefined, setup: PestStrategy): boolean {
  if (!gate) return true;
  return PEST_TIER[setup] >= PEST_TIER[gate];
}

/* ─── Family yield + N/P/K removal defaults ─────────────────────────── */

/** Conservative small-plot yield + nutrient-removal estimates per crop
 *  family. Used to size the pre-plant fertility budget when the crop
 *  plugin doesn't declare its own yield goal. Families not listed get
 *  zero recommendation + a `missing-yield-goal` warning so the operator
 *  knows to add a soil-test-based custom plan. */
interface FamilyRemovalDefault {
  /** Assumed annual yield in lb/acre — used only to derive nutrient
   *  removal; not surfaced as a yield target. */
  yieldGoalLbPerAcre: number;
  nRemovalLbPerAcre: number;
  /** P shown as elemental P2O5 lb/acre (matches fertilizer-bag labeling). */
  pRemovalLbPerAcre: number;
  /** K shown as elemental K2O lb/acre. */
  kRemovalLbPerAcre: number;
  /** Whether this family typically takes a mid-season N sidedress
   *  (corn V6, heavy-feeding brassicas). Drives synthesized sidedress-N
   *  application. */
  sidedressN: boolean;
  /** Days after planting for the sidedress fallback when no growth
   *  stage table is present. Ignored when `sidedressN === false`. */
  sidedressFallbackDays: number;
}

export const FAMILY_REMOVAL_DEFAULTS: Partial<Record<CropFamily, FamilyRemovalDefault>> = {
  corn: {
    yieldGoalLbPerAcre: 5600,
    nRemovalLbPerAcre: 150,
    pRemovalLbPerAcre: 45,
    kRemovalLbPerAcre: 35,
    sidedressN: true,
    sidedressFallbackDays: 35
  },
  brassica: {
    yieldGoalLbPerAcre: 5000,
    nRemovalLbPerAcre: 120,
    pRemovalLbPerAcre: 25,
    kRemovalLbPerAcre: 100,
    sidedressN: true,
    sidedressFallbackDays: 30
  },
  cucurbit: {
    yieldGoalLbPerAcre: 15000,
    nRemovalLbPerAcre: 60,
    pRemovalLbPerAcre: 25,
    kRemovalLbPerAcre: 75,
    sidedressN: false,
    sidedressFallbackDays: 0
  },
  solanaceae: {
    yieldGoalLbPerAcre: 20000,
    nRemovalLbPerAcre: 150,
    pRemovalLbPerAcre: 30,
    kRemovalLbPerAcre: 150,
    sidedressN: false,
    sidedressFallbackDays: 0
  },
  legume: {
    // Legumes fix their own N via Rhizobium nodulation.
    yieldGoalLbPerAcre: 2000,
    nRemovalLbPerAcre: 0,
    pRemovalLbPerAcre: 30,
    kRemovalLbPerAcre: 60,
    sidedressN: false,
    sidedressFallbackDays: 0
  },
  'leafy-green': {
    yieldGoalLbPerAcre: 8000,
    nRemovalLbPerAcre: 80,
    pRemovalLbPerAcre: 20,
    kRemovalLbPerAcre: 100,
    sidedressN: false,
    sidedressFallbackDays: 0
  },
  allium: {
    yieldGoalLbPerAcre: 12000,
    nRemovalLbPerAcre: 80,
    pRemovalLbPerAcre: 30,
    kRemovalLbPerAcre: 80,
    sidedressN: false,
    sidedressFallbackDays: 0
  },
  root: {
    yieldGoalLbPerAcre: 12000,
    nRemovalLbPerAcre: 60,
    pRemovalLbPerAcre: 30,
    kRemovalLbPerAcre: 100,
    sidedressN: false,
    sidedressFallbackDays: 0
  }
};

/** IPM scout cadence per family — emitted when pestStrategy === 'ipm' or
 *  'minimal'. Days are inter-visit gaps; the planner spreads visits
 *  across the active growing window. */
const FAMILY_SCOUT_CADENCE: Partial<
  Record<CropFamily, { recurrenceDays: number; windowDays: number; targets: string }>
> = {
  cucurbit: {
    recurrenceDays: 7,
    windowDays: 90,
    targets: 'squash vine borer, cucumber beetle, squash bug, powdery mildew'
  },
  brassica: {
    recurrenceDays: 5,
    windowDays: 70,
    targets: 'cabbage looper, imported cabbageworm, harlequin bug, flea beetle'
  },
  solanaceae: {
    recurrenceDays: 7,
    windowDays: 100,
    targets: 'tomato hornworm, Colorado potato beetle, early blight, late blight'
  },
  corn: {
    recurrenceDays: 7,
    windowDays: 80,
    targets: 'corn earworm, fall armyworm, European corn borer'
  },
  legume: {
    recurrenceDays: 10,
    windowDays: 70,
    targets: 'bean leaf beetle, Mexican bean beetle, aphids'
  },
  'leafy-green': {
    recurrenceDays: 7,
    windowDays: 45,
    targets: 'aphids, slugs, lettuce drop'
  },
  allium: {
    recurrenceDays: 10,
    windowDays: 90,
    targets: 'onion maggot, onion thrips, downy mildew'
  },
  root: {
    recurrenceDays: 10,
    windowDays: 80,
    targets: 'root maggot, wireworm, leaf miner'
  }
};

/* ─── Output shape ──────────────────────────────────────────────────── */

const DAY_MS = 24 * 60 * 60 * 1000;

/** One concrete product application recommended by the planner. */
export interface InputsPlanApplication {
  /** Unique per-plan identifier for UI keying + commit linkage. */
  id: string;
  plantingId: string;
  blockId: string;
  cropPluginId: string;
  /** Which slot the application fills. */
  slot: SprayWindowPurpose | 'pre-plant-fertility';
  /** Picked product. `null` when no philosophy-compliant product exists;
   *  the UI surfaces a substitution prompt and `warnings[]` carries the
   *  `no-compliant-product` reason. */
  productPluginId: string | null;
  productDisplayName: string | null;
  productCategory: 'herbicide' | 'insecticide' | 'fungicide' | 'fertilizer';
  /** Earliest date the operator should apply, epoch ms. */
  windowStartMs: number;
  /** Latest date the operator should apply, epoch ms. */
  windowEndMs: number;
  /** The planner's pick within the window — defaults to start; the AI
   *  layer can shift within `[windowStartMs, windowEndMs]`. */
  applicationDateMs: number;
  /** Per-acre rate in the product plugin's native units. */
  rateAmount: number | null;
  rateUnit: string | null;
  /** Block acreage. */
  acres: number;
  /** Total product needed = `rateAmount × acres`. `null` when no product. */
  totalAmount: number | null;
  /** Reason summary for the operator + chat thread. */
  rationale: string;
  /** #480 — `data` when the product was picked because the farm has it on
   *  hand, `plugin` for the catalog default, `manual` once the farmer
   *  changes it, `ai` for an AI substitution. */
  productSource?: ProductSource;
  /** #480 — every product the farmer may pick for this slot, on-hand first
   *  (enough, then some, then none). */
  options?: InputsPlanProductOption[];
  /** #710 — a pre-plant application covers the whole bed once, for every
   *  planting in it. */
  coversPlantingIds?: string[];
}

/** A recurring scout reminder — surfaced in `tasks` with a recurrence
 *  rule, not as a one-shot application. */
export interface InputsPlanScoutTask {
  id: string;
  plantingId: string;
  blockId: string;
  cropPluginId: string;
  title: string;
  body: string;
  recurrenceDays: number;
  windowStartMs: number;
  windowEndMs: number;
}

/** Consolidated buy list — collapsed by `pluginId` across all
 *  applications. */
export interface InputsPlanShoppingItem {
  pluginId: string;
  category: 'herbicide' | 'insecticide' | 'fungicide' | 'fertilizer';
  displayName: string;
  unit: string;
  totalNeeded: number;
  onHand: number;
  shortfall: number;
  /** Set to the stock's unit when the farm has this product but in a unit
   *  the rate cannot be converted to (a volume against a weight). */
  stockUnitMismatch?: string;
  /** #721 — that stock's balance in its own unit. */
  stockOnHandInStockUnit?: number;
  appliesToPlantingIds: string[];
}

export type PlannerWarning =
  | {
      kind: 'no-compliant-product';
      plantingId: string;
      slot: SprayWindowPurpose | 'pre-plant-fertility';
      reason: string;
    }
  | {
      kind: 'missing-yield-goal';
      plantingId: string;
      cropPluginId?: string;
      cropFamily: string;
    }
  | {
      /** #720 — crops whose library entry has no herbicide timing, so no
       *  herbicide was planned for them although the weed strategy allows
       *  one. One warning for the whole plan. */
      kind: 'no-herbicide-timing';
      plantingId: string;
      plantingIds: string[];
    }
  | {
      kind: 'missing-spray-window-purpose';
      plantingId: string;
      cropPluginId: string;
      windowTitle: string;
    }
  | {
      kind: 'missing-anchor-date';
      plantingId: string;
    }
  | {
      kind: 'no-growth-stage-table';
      plantingId: string;
      cropPluginId: string;
      slot: SprayWindowPurpose;
    };

export interface InputsPlan {
  applications: InputsPlanApplication[];
  scoutTasks: InputsPlanScoutTask[];
  shoppingList: InputsPlanShoppingItem[];
  /** #480 — on-hand balance per product plugin, so the Inputs step can
   *  rebuild the shopping list after the farmer changes a product. */
  stockOnHand?: Record<string, StockAmount[]>;
  warnings: PlannerWarning[];
  meta: {
    year: number;
    philosophy: Philosophy;
    weedStrategy: WeedStrategy;
    pestStrategy: PestStrategy;
    fertilityApproach: FertilityApproach;
    generatedAtMs: number;
  };
}

/* ─── Input shape ───────────────────────────────────────────────────── */

/** A stock row with an `onHand` decimal balance — accept either the
 *  `StockItemWithBalance` shape from `db/stock.ts` or a hand-rolled
 *  equivalent so callers aren't forced to import the DB type. */
export interface InputsPlanStockRef {
  pluginId?: string;
  category: 'herbicide' | 'insecticide' | 'fungicide' | 'fertilizer' | string;
  displayName: string;
  defaultUnit: string;
  onHand: number;
}

/** Lighter-weight planting shape accepted by the planner. The persisted
 *  `PlantingRecord` from the DB satisfies it, but so does an in-memory
 *  provisional planting carried by the wizard before the commit step
 *  has persisted the underlying rows. */
export interface InputsPlanProvisionalPlanting {
  id: string;
  blockId: string;
  cropPluginId: string;
  varietyDisplayName: string;
  plantingDate: number | null;
}

export interface InputsPlanInput {
  plantings: ReadonlyArray<InputsPlanProvisionalPlanting>;
  blocks: ReadonlyArray<Block>;
  cropPlugins: Record<string, CropPlugin>;
  seasonSetup: SeasonSetup;
  soilTests: ReadonlyArray<SoilTest>;
  fertilityCredits: ReadonlyArray<FertilityCredit>;
  productPlugins: {
    herbicides: ReadonlyArray<HerbicidePlugin>;
    insecticides: ReadonlyArray<InsecticidePlugin>;
    fertilizers: ReadonlyArray<FertilizerPlugin>;
    fungicides: ReadonlyArray<FungicidePlugin>;
  };
  existingStock: ReadonlyArray<InputsPlanStockRef>;
  year: number;
  /** UC-47 — per-block cover-crop N-credit derived from the ACTUAL prior-year
   *  terminated `cover-crop.termination` plantings (subsumes #228's real fix).
   *  When a block appears here, its value overrides the flat, season-setup-
   *  *declared* `nCreditForIntent(coverCropIntent)` for that block only.
   *  Blocks absent from this map fall back to the declared-intent credit, so
   *  the legacy behavior is preserved for anyone who didn't run the
   *  carry-forward prep. */
  coverNCreditByBlock?: Record<string, number>;
  /** Optional clock injection for tests. Defaults to `Date.now()`. */
  nowMs?: number;
}

/* ─── Helpers ───────────────────────────────────────────────────────── */

/** Soil-test N credit, lb/acre. Conservative: anything above an 8 ppm
 *  nitrate baseline credits 4 lb-N/acre per ppm. Mehlich-3 is the
 *  default lab method for our region; the multiplier is the Penn State
 *  PSNT crediting table simplification. Every baseline below is in ppm,
 *  so a lab sheet typed in lb/acre is converted first. */
export function nCreditFromSoilTestLbPerAcre(test: SoilTest | undefined): number {
  const ppm = toPpm(test?.nitratePpm, test?.unitsBasis);
  if (ppm == null) return 0;
  return Math.max(0, (ppm - 8) * 4);
}

/** P2O5 credit: above 25 ppm Mehlich-3 P, credit 0.5 lb P2O5 per ppm. */
export function pCreditFromSoilTestLbPerAcre(test: SoilTest | undefined): number {
  const ppm = toPpm(test?.phosphorusPpm, test?.unitsBasis);
  if (ppm == null) return 0;
  return Math.max(0, (ppm - 25) * 0.5);
}

/** K2O credit: above 120 ppm Mehlich-3 K, credit 0.5 lb K2O per ppm. */
export function kCreditFromSoilTestLbPerAcre(test: SoilTest | undefined): number {
  const ppm = toPpm(test?.potassiumPpm, test?.unitsBasis);
  if (ppm == null) return 0;
  return Math.max(0, (ppm - 120) * 0.5);
}

/** Sum N/P/K (lb/acre) from explicit operator-entered fertility credits
 *  for this block + year. */
function sumCredits(
  credits: ReadonlyArray<FertilityCredit>,
  blockId: string,
  year: number
): { n: number; p: number; k: number } {
  let n = 0;
  let p = 0;
  let k = 0;
  for (const c of credits) {
    if (c.blockId !== blockId || c.appliesToYear !== year) continue;
    n += c.nLbPerAcre ?? 0;
    p += c.pLbPerAcre ?? 0;
    k += c.kLbPerAcre ?? 0;
  }
  return { n, p, k };
}

/** Latest soil test for a block, regardless of year — soil chemistry
 *  changes slowly enough that an older test is still useful. The UI
 *  warns when the test is >3y old. */
function latestSoilTest(tests: ReadonlyArray<SoilTest>, blockId: string): SoilTest | undefined {
  let best: SoilTest | undefined;
  for (const t of tests) {
    if (t.blockId !== blockId) continue;
    if (!best || t.sampledAt > best.sampledAt) best = t;
  }
  return best;
}

/** Resolve a spray window's date range to absolute epoch ms, given the
 *  crop's planting date + (optional) growth stage table. Returns null
 *  when the anchor can't be resolved (no plantingDate, or `stage`
 *  anchor with no matching stageCode). */
function resolveWindowDates(
  window: CropSprayWindow,
  plantingDateMs: number | null,
  crop: CropPlugin
): { startMs: number; endMs: number } | null {
  if (plantingDateMs == null) return null;
  if (window.anchor === 'planting') {
    return {
      startMs: plantingDateMs + window.offsetDaysMin * DAY_MS,
      endMs: plantingDateMs + window.offsetDaysMax * DAY_MS
    };
  }
  if (window.anchor === 'emergence') {
    // Lacking a real emergence date, approximate as planting + 7d.
    const emergenceMs = plantingDateMs + 7 * DAY_MS;
    return {
      startMs: emergenceMs + window.offsetDaysMin * DAY_MS,
      endMs: emergenceMs + window.offsetDaysMax * DAY_MS
    };
  }
  // anchor === 'stage' — look up daysFromPlanting from the stage table.
  if (!window.stageCode || !crop.growthStageTable) return null;
  const stage = crop.growthStageTable.stages.find((s) => s.code === window.stageCode);
  if (!stage) return null;
  const stageMidDays = (stage.daysFromPlanting.min + stage.daysFromPlanting.max) / 2;
  return {
    startMs: plantingDateMs + (stageMidDays + window.offsetDaysMin) * DAY_MS,
    endMs: plantingDateMs + (stageMidDays + window.offsetDaysMax) * DAY_MS
  };
}

/* ─── Candidate products (#480) ────────────────────────────────────── */

interface Candidate {
  plugin: { pluginId: string; displayName: string };
  rateAmount: number | null;
  rateUnit: string | null;
}

/** A fertilizer that supplies none of the budgeted nutrients (lime, gypsum,
 *  a copper or calcium foliar) gets no rate and cannot fill the slot, so
 *  it is not offered for it. */
function suppliesBudget(c: Candidate): boolean {
  return c.rateAmount != null && c.rateAmount > 0;
}

interface Ranked extends Candidate {
  option: InputsPlanProductOption;
}

/** Options sent with each application; on-hand ones sort first, so the cap
 *  only ever drops products the farm does not have. */
const MAX_OPTIONS = 40;

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Orders candidates so an allowed product the farm has always beats one it
 *  would have to buy: enough on hand, then some, then none. Ties keep the
 *  catalog preference order the candidates arrive in. */
function rankCandidates(
  candidates: ReadonlyArray<Candidate>,
  acres: number,
  stockLeft: ReadonlyMap<string, StockAmount[]>
): Ranked[] {
  const ranked = candidates.map((c, i) => {
    const total = c.rateAmount != null ? round2(c.rateAmount * acres) : null;
    const inRateUnit = onHandInUnit(stockLeft.get(c.plugin.pluginId), c.rateUnit);
    const onHand = inRateUnit == null ? null : Math.max(0, inRateUnit);
    return {
      ...c,
      i,
      option: {
        pluginId: c.plugin.pluginId,
        displayName: c.plugin.displayName,
        rateAmount: c.rateAmount,
        rateUnit: c.rateUnit,
        totalAmount: total,
        onHand: round2(onHand ?? 0),
        stock: stockCoverage(onHand, total)
      }
    };
  });
  ranked.sort(
    (a, b) => STOCK_COVERAGE_RANK[a.option.stock] - STOCK_COVERAGE_RANK[b.option.stock] || a.i - b.i
  );
  return ranked.map(({ i: _i, ...r }) => r);
}

/** The chosen product's fields for an application, plus its options. Takes
 *  the pick's amount out of `stockLeft` so a later application sees what is
 *  really left. */
function chooseProduct(
  ranked: ReadonlyArray<Ranked>,
  stockLeft: Map<string, StockAmount[]>
): Pick<
  InputsPlanApplication,
  | 'productPluginId'
  | 'productDisplayName'
  | 'rateAmount'
  | 'rateUnit'
  | 'totalAmount'
  | 'productSource'
  | 'options'
> {
  const pick = ranked[0];
  const options = ranked.slice(0, MAX_OPTIONS).map((r) => r.option);
  if (!pick) {
    return {
      productPluginId: null,
      productDisplayName: null,
      rateAmount: null,
      rateUnit: null,
      totalAmount: null,
      productSource: 'plugin',
      options
    };
  }
  const total = pick.option.totalAmount;
  const held = stockLeft.get(pick.plugin.pluginId);
  if (total != null && total > 0 && held && pick.rateUnit) {
    takeStockAmount(held, total, pick.rateUnit);
  }
  return {
    productPluginId: pick.plugin.pluginId,
    productDisplayName: pick.plugin.displayName,
    rateAmount: pick.rateAmount,
    rateUnit: pick.rateUnit,
    totalAmount: total,
    productSource: pick.option.stock === 'none' ? 'plugin' : 'data',
    options
  };
}

function rateOf(p: unknown): { amount: number; unit: string } | undefined {
  if (!p || typeof p !== 'object' || !('ratePerAcre' in p)) return undefined;
  const r = (p as { ratePerAcre?: { amount?: unknown; unit?: unknown } }).ratePerAcre;
  return r && typeof r.amount === 'number' && typeof r.unit === 'string'
    ? { amount: r.amount, unit: r.unit }
    : undefined;
}

function rateCandidate(p: { pluginId: string; displayName: string }): Candidate {
  const rate = rateOf(p);
  return { plugin: p, rateAmount: rate?.amount ?? null, rateUnit: rate?.unit ?? null };
}

/** True when the herbicide's chemistry would not harm the standing crop. */
function herbicideSafeOnCrop(h: HerbicidePlugin, crop: CropPlugin): boolean {
  const product: HerbicideProduct = {
    pluginId: h.pluginId,
    displayName: h.displayName,
    activeIngredients: h.activeIngredients.map((ai) => ({
      name: ai.name,
      chemistryClass: ai.chemistryClass as ChemistryClass
    }))
  };
  return (
    checkCropCompatibility([product], {
      cropPluginId: crop.pluginId,
      cropFamily: crop.cropFamily
    }).length === 0
  );
}

/** Herbicides for a declared window: the window's chemistry class, allowed
 *  under the philosophy, and for a post-emergent spray safe on the crop
 *  that is already in the ground. */
function herbicideCandidates(
  window: CropSprayWindow,
  pool: ReadonlyArray<HerbicidePlugin>,
  philosophy: Philosophy,
  crop: CropPlugin,
  purpose: SprayWindowPurpose
): Candidate[] {
  return pool
    .filter((h) => h.activeIngredients.some((ai) => ai.chemistryClass === window.chemistryClass))
    .filter((h) => isProductAllowed(h, philosophy))
    .filter((h) => purpose !== 'post-emergent' || herbicideSafeOnCrop(h, crop))
    .map(rateCandidate);
}

/** Every philosophy-allowed plugin in the pool, catalog order. */
function allowedCandidates<T extends Parameters<typeof isProductAllowed>[0]>(
  pool: ReadonlyArray<T>,
  philosophy: Philosophy
): Candidate[] {
  return pool
    .filter((p) => isProductAllowed(p, philosophy))
    .map((p) => rateCandidate(p as unknown as { pluginId: string; displayName: string }));
}

/** Fertilizers in preference order for the requested nutrient emphasis:
 *  `'n'` puts the highest-N first; `'balanced'` puts products with all
 *  three nutrients first. Compost and cover-crop approaches prefer
 *  `organic === true` products when any are allowed, and the synthetic
 *  approach prefers the ones that are not. */
function fertilizerPreference(
  pool: ReadonlyArray<FertilizerPlugin>,
  philosophy: Philosophy,
  emphasis: 'n' | 'balanced',
  approach: FertilityApproach
): FertilizerPlugin[] {
  const allowed = pool.filter((p) => isProductAllowed(p, philosophy));
  if (allowed.length === 0) return [];
  const approachFiltered =
    approach === 'compost-amendments' || approach === 'cover-crop-credits'
      ? allowed.filter((p) => p.organic === true)
      : approach === 'synthetic'
        ? allowed.filter((p) => p.organic !== true)
        : allowed;
  const pool2 = approachFiltered.length > 0 ? approachFiltered : allowed;
  if (emphasis === 'n') return [...pool2].sort((a, b) => b.analysis.n - a.analysis.n);
  const complete = (p: FertilizerPlugin) =>
    p.analysis.n > 0 && p.analysis.p > 0 && p.analysis.k > 0;
  return [...pool2.filter(complete), ...pool2.filter((p) => !complete(p))];
}

/** Pre-plant fertilizer rate in lb/acre derived from the dominant
 *  deficit nutrient + the fertilizer's analysis. Returns 0 when the
 *  fertilizer can't deliver the nutrient (all-zero analysis). */
function fertilizerRateFromDeficit(
  deficit: { n: number; p: number; k: number },
  fert: FertilizerPlugin
): number {
  // Pick the largest absolute deficit, then size the application to
  // cover it. This intentionally over-supplies the other nutrients
  // rather than under-supplying the dominant one.
  const targets: Array<{ nutrient: 'n' | 'p' | 'k'; need: number; pct: number }> = (
    [
      { nutrient: 'n' as const, need: Math.max(0, deficit.n), pct: fert.analysis.n },
      { nutrient: 'p' as const, need: Math.max(0, deficit.p), pct: fert.analysis.p },
      { nutrient: 'k' as const, need: Math.max(0, deficit.k), pct: fert.analysis.k }
    ] satisfies Array<{ nutrient: 'n' | 'p' | 'k'; need: number; pct: number }>
  ).filter((t) => t.need > 0 && t.pct > 0);
  if (targets.length === 0) return 0;

  // Required lb/acre per nutrient: need_lb / (pct / 100).
  const rates = targets.map((t) => t.need / (t.pct / 100));
  // Use the max — that covers the dominant deficit.
  return Math.ceil(Math.max(...rates));
}

/** Stable id generator for plan rows. Deterministic per (planting, slot,
 *  index) so the UI can dedupe + the AI layer can reference the row by
 *  id without ambient ordering. */
function applicationId(plantingId: string, slot: string, index: number): string {
  return `${plantingId}::${slot}::${index}`;
}

function isWeedPurpose(purpose: SprayWindowPurpose | undefined): boolean {
  return purpose === 'burndown' || purpose === 'pre-emergent' || purpose === 'post-emergent';
}

/* ─── Per-bed facts (#710) ──────────────────────────────────────────── */

/** A bed is prepared once a season, whatever is grown in it: one pre-plant
 *  fertility pass before its first planting, sized for the hungriest crop
 *  family in it, and one cover-crop termination. */
interface BedPlan {
  firstPlantingId: string;
  firstPlantingMs: number;
  plantingIds: string[];
  fertility?: {
    leadPlantingId: string;
    families: string[];
    removal: { n: number; p: number; k: number };
  };
}

function planBeds(input: InputsPlanInput): Map<string, BedPlan> {
  const byBlock = new Map<
    string,
    Array<{ planting: InputsPlanProvisionalPlanting; crop: CropPlugin }>
  >();
  const blockIds = new Set(input.blocks.map((b) => b.id));
  for (const planting of input.plantings) {
    const crop = input.cropPlugins[planting.cropPluginId];
    if (!crop || !blockIds.has(planting.blockId) || planting.plantingDate == null) continue;
    const list = byBlock.get(planting.blockId) ?? [];
    list.push({ planting, crop });
    byBlock.set(planting.blockId, list);
  }
  const beds = new Map<string, BedPlan>();
  for (const [blockId, list] of byBlock) {
    const sorted = list
      .map((x, i) => ({ ...x, i }))
      .sort((a, b) => a.planting.plantingDate! - b.planting.plantingDate! || a.i - b.i);
    const first = sorted[0];
    const bed: BedPlan = {
      firstPlantingId: first.planting.id,
      firstPlantingMs: first.planting.plantingDate!,
      plantingIds: sorted.map((x) => x.planting.id)
    };
    const fed = sorted.filter((x) => FAMILY_REMOVAL_DEFAULTS[x.crop.cropFamily]);
    if (fed.length > 0) {
      const removal = { n: 0, p: 0, k: 0 };
      const families: string[] = [];
      for (const x of fed) {
        const d = FAMILY_REMOVAL_DEFAULTS[x.crop.cropFamily]!;
        removal.n = Math.max(removal.n, d.nRemovalLbPerAcre);
        removal.p = Math.max(removal.p, d.pRemovalLbPerAcre);
        removal.k = Math.max(removal.k, d.kRemovalLbPerAcre);
        if (!families.includes(x.crop.cropFamily)) families.push(x.crop.cropFamily);
      }
      bed.fertility = { leadPlantingId: fed[0].planting.id, families, removal };
    }
    beds.set(blockId, bed);
  }
  return beds;
}

/** One scout reminder per bed and pest list: successions and crops of one
 *  family in a bed share a walk (#710). */
function mergeScoutTasks(
  tasks: ReadonlyArray<InputsPlanScoutTask>,
  input: InputsPlanInput
): InputsPlanScoutTask[] {
  const nameOf = new Map(input.plantings.map((p) => [p.id, p.varietyDisplayName]));
  const groups = new Map<string, InputsPlanScoutTask[]>();
  for (const t of tasks) {
    const family = input.cropPlugins[t.cropPluginId]?.cropFamily ?? t.cropPluginId;
    const key = `${t.blockId}\u0000${family}`;
    const list = groups.get(key) ?? [];
    list.push(t);
    groups.set(key, list);
  }
  const out: InputsPlanScoutTask[] = [];
  for (const list of groups.values()) {
    if (list.length === 1) {
      out.push(list[0]);
      continue;
    }
    const sorted = [...list].sort((a, b) => a.windowStartMs - b.windowStartMs);
    const lead = sorted[0];
    const cadence = FAMILY_SCOUT_CADENCE[input.cropPlugins[lead.cropPluginId]?.cropFamily];
    const names = [...new Set(sorted.map((t) => nameOf.get(t.plantingId) ?? t.cropPluginId))];
    out.push({
      ...lead,
      title: cadence ? `Scout ${names.join(', ')} for ${cadence.targets}` : lead.title,
      recurrenceDays: Math.min(...sorted.map((t) => t.recurrenceDays)),
      windowStartMs: lead.windowStartMs,
      windowEndMs: Math.max(...sorted.map((t) => t.windowEndMs))
    });
  }
  return out;
}

function warningKey(w: PlannerWarning, cropOf: (plantingId: string) => string): string {
  switch (w.kind) {
    case 'no-compliant-product':
      return `${w.kind}|${cropOf(w.plantingId)}|${w.slot}|${w.reason}`;
    case 'missing-yield-goal':
      return `${w.kind}|${cropOf(w.plantingId)}`;
    case 'missing-spray-window-purpose':
      return `${w.kind}|${w.cropPluginId}|${w.windowTitle}`;
    case 'no-growth-stage-table':
      return `${w.kind}|${w.cropPluginId}`;
    case 'missing-anchor-date':
    case 'no-herbicide-timing':
      return `${w.kind}|${w.plantingId}`;
  }
}

/** One warning per crop and kind, not one per planting or per window (#721). */
function dedupeWarnings(
  warnings: ReadonlyArray<PlannerWarning>,
  input: InputsPlanInput
): PlannerWarning[] {
  const cropOfPlanting = new Map(input.plantings.map((p) => [p.id, p.cropPluginId]));
  const cropOf = (id: string) => cropOfPlanting.get(id) ?? id;
  const seen = new Set<string>();
  const out: PlannerWarning[] = [];
  for (const w of warnings) {
    const key = warningKey(w, cropOf);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(w);
  }
  return out;
}

/* ─── Per-planting decisions ─────────────────────────────────────── */

interface PerPlantingOutput {
  applications: InputsPlanApplication[];
  scoutTasks: InputsPlanScoutTask[];
  warnings: PlannerWarning[];
}

function planForPlanting(
  planting: InputsPlanProvisionalPlanting,
  block: Block,
  crop: CropPlugin,
  input: InputsPlanInput,
  stockLeft: Map<string, StockAmount[]>,
  bed: BedPlan | undefined
): PerPlantingOutput {
  const { seasonSetup, productPlugins, soilTests, fertilityCredits, year } = input;
  const applications: InputsPlanApplication[] = [];
  const scoutTasks: InputsPlanScoutTask[] = [];
  const warnings: PlannerWarning[] = [];

  const acres =
    effectiveAcresFor({
      acres: block.acres ?? null,
      geometryGeojson: block.geometryGeojson ?? null
    }) ?? 0;

  const plantingDateMs = planting.plantingDate;

  if (plantingDateMs == null) {
    warnings.push({ kind: 'missing-anchor-date', plantingId: planting.id });
  }

  /* 1. Plugin-declared sprayWindows ─────────────────────────────── */

  let windowIndex = 0;
  for (const window of crop.sprayWindows ?? []) {
    if (!window.purpose) {
      warnings.push({
        kind: 'missing-spray-window-purpose',
        plantingId: planting.id,
        cropPluginId: crop.pluginId,
        windowTitle: window.title
      });
      continue;
    }

    // IPM exclusion: prophylactic insecticide windows are dropped for
    // ipm/minimal users — they get scout tasks instead.
    if (
      window.purpose === 'insecticide-prophylactic' &&
      (seasonSetup.pestStrategy === 'ipm' || seasonSetup.pestStrategy === 'minimal')
    ) {
      continue;
    }

    // Strategy gates.
    if (!weedStrategyAllows(effectiveWeedGate(window), seasonSetup.weedStrategy)) continue;
    if (!pestGateAllows(window.pestStrategyGate, seasonSetup.pestStrategy)) continue;

    const dates = resolveWindowDates(window, plantingDateMs, crop);
    if (!dates) {
      if (window.anchor === 'stage' && !crop.growthStageTable) {
        warnings.push({
          kind: 'no-growth-stage-table',
          plantingId: planting.id,
          cropPluginId: crop.pluginId,
          slot: window.purpose
        });
      }
      continue;
    }

    const { category, candidates } = candidatesForPurpose(
      window,
      window.purpose,
      productPlugins,
      seasonSetup.philosophy,
      crop
    );
    const choice = chooseProduct(rankCandidates(candidates, acres, stockLeft), stockLeft);

    if (!choice.productPluginId) {
      const reason = reasonForEmptyPool(window.purpose, seasonSetup.philosophy);
      warnings.push({
        kind: 'no-compliant-product',
        plantingId: planting.id,
        slot: window.purpose,
        reason
      });
    }

    applications.push({
      id: applicationId(planting.id, window.purpose, windowIndex++),
      plantingId: planting.id,
      blockId: planting.blockId,
      cropPluginId: planting.cropPluginId,
      slot: window.purpose,
      productCategory: category,
      windowStartMs: dates.startMs,
      windowEndMs: dates.endMs,
      applicationDateMs: dates.startMs,
      acres,
      rationale: window.body ?? window.title,
      ...choice
    });
  }

  /* 2. Pre-plant fertility (synthesized) ─────────────────────────── */

  const removal = FAMILY_REMOVAL_DEFAULTS[crop.cropFamily];
  const bedFert = bed?.fertility;
  if (!removal && !bedFert) {
    warnings.push({
      kind: 'missing-yield-goal',
      plantingId: planting.id,
      cropPluginId: crop.pluginId,
      cropFamily: crop.cropFamily
    });
  } else if (bed && bedFert && bedFert.leadPlantingId === planting.id && acres > 0) {
    const bedRemoval = bedFert.removal;
    const test = latestSoilTest(soilTests, planting.blockId);
    const explicitCredits = sumCredits(fertilityCredits, planting.blockId, year);
    const soilCredits = {
      n: nCreditFromSoilTestLbPerAcre(test),
      p: pCreditFromSoilTestLbPerAcre(test),
      k: kCreditFromSoilTestLbPerAcre(test)
    };
    const deficit = {
      n: bedRemoval.n - soilCredits.n - explicitCredits.n,
      p: bedRemoval.p - soilCredits.p - explicitCredits.p,
      k: bedRemoval.k - soilCredits.k - explicitCredits.k
    };

    // UC-47 — prefer the per-block credit from ACTUAL terminated cover crops
    // when the carry-forward prep supplied it; otherwise fall back to the
    // flat season-setup-declared intent credit (#228 legacy path).
    const actualBlockCredit = input.coverNCreditByBlock?.[planting.blockId];
    const coverNCredit =
      seasonSetup.fertilityApproach === 'cover-crop-credits'
        ? (actualBlockCredit ?? nCreditForIntent(seasonSetup.coverCropIntent))
        : 0;
    if (coverNCredit > 0) {
      deficit.n = deficit.n - coverNCredit;
    }

    const totalDeficit = Math.max(0, deficit.n) + Math.max(0, deficit.p) + Math.max(0, deficit.k);

    if (totalDeficit > 0) {
      const emphasis = deficit.n >= deficit.p && deficit.n >= deficit.k ? 'n' : 'balanced';
      const choice = chooseProduct(
        rankCandidates(
          fertilizerPreference(
            productPlugins.fertilizers,
            seasonSetup.philosophy,
            emphasis,
            seasonSetup.fertilityApproach
          )
            .map((f) => {
              const rate = fertilizerRateFromDeficit(deficit, f);
              return {
                plugin: f,
                rateAmount: rate || null,
                rateUnit: 'lb'
              };
            })
            .filter(suppliesBudget),
          acres,
          stockLeft
        ),
        stockLeft
      );

      if (!choice.productPluginId) {
        warnings.push({
          kind: 'no-compliant-product',
          plantingId: planting.id,
          slot: 'pre-plant-fertility',
          reason: `No ${seasonSetup.philosophy}-compliant fertilizer in catalog for ${seasonSetup.fertilityApproach} approach.`
        });
      }

      const windowEnd = bed.firstPlantingMs - 7 * DAY_MS;
      const windowStart = bed.firstPlantingMs - 21 * DAY_MS;

      applications.push({
        id: applicationId(planting.id, 'pre-plant-fertility', 0),
        plantingId: planting.id,
        blockId: planting.blockId,
        cropPluginId: planting.cropPluginId,
        slot: 'pre-plant-fertility',
        productCategory: 'fertilizer',
        windowStartMs: windowStart,
        windowEndMs: windowEnd,
        applicationDateMs: windowStart,
        acres,
        ...choice,
        coversPlantingIds: bed.plantingIds,
        rationale:
          `Pre-plant fertility budget: ` +
          `N ${Math.max(0, deficit.n).toFixed(0)} lb/ac, ` +
          `P₂O₅ ${Math.max(0, deficit.p).toFixed(0)} lb/ac, ` +
          `K₂O ${Math.max(0, deficit.k).toFixed(0)} lb/ac ` +
          `(${bedFert.families.join(' / ')} removal at family default − soil credits − fertility credits` +
          (coverNCredit > 0
            ? ` − ${coverNCredit} lb-N/ac cover-crop credit (${seasonSetup.coverCropIntent})`
            : '') +
          `).`
      });
    }
  }

  /* 3. Sidedress-N (synthesized for family-default heavy feeders) ── */

  if (
    removal?.sidedressN &&
    plantingDateMs != null &&
    !(crop.sprayWindows ?? []).some((w) => w.purpose === 'sidedress-n')
  ) {
    const sidedressRate = 40; // lb-N/acre conservative split application
    const choice = chooseProduct(
      rankCandidates(
        fertilizerPreference(
          productPlugins.fertilizers,
          seasonSetup.philosophy,
          'n',
          seasonSetup.fertilityApproach
        )
          .map((f) => ({
            plugin: f,
            rateAmount: f.analysis.n > 0 ? Math.ceil(sidedressRate / (f.analysis.n / 100)) : null,
            rateUnit: 'lb'
          }))
          .filter(suppliesBudget),
        acres,
        stockLeft
      ),
      stockLeft
    );

    if (!choice.productPluginId) {
      warnings.push({
        kind: 'no-compliant-product',
        plantingId: planting.id,
        slot: 'sidedress-n',
        reason: `No ${seasonSetup.philosophy}-compliant high-N fertilizer available for sidedress.`
      });
    }

    // Anchor: V6 (or family-equivalent) growth stage when present;
    // fallback to family-default day offset.
    let anchorDays = removal.sidedressFallbackDays;
    const v6 = crop.growthStageTable?.stages.find(
      (s) => s.code.toLowerCase() === 'v6' || s.code.toLowerCase() === 'tillering'
    );
    if (v6) anchorDays = Math.round((v6.daysFromPlanting.min + v6.daysFromPlanting.max) / 2);

    const sidedressDateMs = plantingDateMs + anchorDays * DAY_MS;

    applications.push({
      id: applicationId(planting.id, 'sidedress-n', 0),
      plantingId: planting.id,
      blockId: planting.blockId,
      cropPluginId: planting.cropPluginId,
      slot: 'sidedress-n',
      productCategory: 'fertilizer',
      windowStartMs: sidedressDateMs - 3 * DAY_MS,
      windowEndMs: sidedressDateMs + 7 * DAY_MS,
      applicationDateMs: sidedressDateMs,
      acres,
      ...choice,
      rationale: `Sidedress N (~40 lb-N/ac) at ${v6 ? `stage ${v6.code}` : `+${anchorDays}d`}; covers post-emergence demand peak for ${crop.cropFamily}.`
    });
  }

  /* 4. Cover-crop terminate (synthesized when coverCropIntent set) ── */

  if (
    seasonSetup.coverCropIntent !== 'none' &&
    plantingDateMs != null &&
    bed?.firstPlantingId === planting.id &&
    !(crop.sprayWindows ?? []).some((w) => w.purpose === 'cover-terminate')
  ) {
    const useHerbicide = seasonSetup.weedStrategy !== 'cultivate-first';
    const choice = chooseProduct(
      useHerbicide
        ? rankCandidates(
            allowedCandidates(productPlugins.herbicides, seasonSetup.philosophy),
            acres,
            stockLeft
          )
        : [],
      stockLeft
    );
    if (useHerbicide) {
      if (!choice.productPluginId) {
        warnings.push({
          kind: 'no-compliant-product',
          plantingId: planting.id,
          slot: 'cover-terminate',
          reason: `No ${seasonSetup.philosophy}-compliant herbicide for cover-crop termination.`
        });
      }
    }
    // No-till leaves the residue on the surface, so it can't be incorporated.
    const mechanicalTerminate =
      seasonSetup.philosophy === 'no-till' ? 'Roller-crimp' : 'Mow + incorporate';
    const terminateDateMs = plantingDateMs - 21 * DAY_MS;
    applications.push({
      id: applicationId(planting.id, 'cover-terminate', 0),
      plantingId: planting.id,
      blockId: planting.blockId,
      cropPluginId: planting.cropPluginId,
      slot: 'cover-terminate',
      productCategory: 'herbicide',
      windowStartMs: terminateDateMs - 7 * DAY_MS,
      windowEndMs: terminateDateMs + 7 * DAY_MS,
      applicationDateMs: terminateDateMs,
      acres,
      ...choice,
      coversPlantingIds: bed.plantingIds,
      productDisplayName:
        choice.productDisplayName ??
        (useHerbicide ? null : `${mechanicalTerminate} (no herbicide)`),
      rationale: useHerbicide
        ? `Terminate prior-year ${seasonSetup.coverCropIntent} cover crop ~3 weeks before planting.`
        : `${mechanicalTerminate} ${seasonSetup.coverCropIntent} cover crop ~3 weeks before planting (cultivation-first weed strategy).`
    });
  }

  /* 5. IPM scout cadence (when ipm or minimal pest strategy) ──────── */

  if (
    (seasonSetup.pestStrategy === 'ipm' || seasonSetup.pestStrategy === 'minimal') &&
    plantingDateMs != null
  ) {
    const cadence = FAMILY_SCOUT_CADENCE[crop.cropFamily];
    if (cadence) {
      scoutTasks.push({
        id: applicationId(planting.id, 'scout', 0),
        plantingId: planting.id,
        blockId: planting.blockId,
        cropPluginId: planting.cropPluginId,
        title: `Scout ${planting.varietyDisplayName} for ${cadence.targets}`,
        body: `Walk the block, count target pests/lesions on representative plants. If any cross treatment thresholds, log via /scout and the system will queue the right insecticide.`,
        recurrenceDays: cadence.recurrenceDays,
        windowStartMs: plantingDateMs + 14 * DAY_MS,
        windowEndMs: plantingDateMs + cadence.windowDays * DAY_MS
      });
    }
  }

  return { applications, scoutTasks, warnings };
}

/* ─── Product picking by purpose ────────────────────────────────────── */

interface PurposeCandidates {
  category: 'herbicide' | 'insecticide' | 'fungicide' | 'fertilizer';
  candidates: Candidate[];
}

function candidatesForPurpose(
  window: CropSprayWindow,
  purpose: SprayWindowPurpose,
  pools: InputsPlanInput['productPlugins'],
  philosophy: Philosophy,
  crop: CropPlugin
): PurposeCandidates {
  switch (purpose) {
    case 'burndown':
    case 'pre-emergent':
    case 'post-emergent':
    case 'cover-terminate':
      return {
        category: 'herbicide',
        candidates: herbicideCandidates(window, pools.herbicides, philosophy, crop, purpose)
      };
    case 'insecticide-prophylactic':
    case 'insecticide-scouted':
      return {
        category: 'insecticide',
        candidates: allowedCandidates(pools.insecticides, philosophy)
      };
    case 'fungicide':
      return { category: 'fungicide', candidates: allowedCandidates(pools.fungicides, philosophy) };
    case 'sidedress-n':
    case 'sidedress-other':
      return {
        category: 'fertilizer',
        candidates: fertilizerPreference(pools.fertilizers, philosophy, 'n', 'mixed').map(
          rateCandidate
        )
      };
  }
}

function reasonForEmptyPool(
  slot: SprayWindowPurpose | 'pre-plant-fertility',
  philosophy: Philosophy
): string {
  const family =
    slot === 'burndown' ||
    slot === 'pre-emergent' ||
    slot === 'post-emergent' ||
    slot === 'cover-terminate'
      ? 'herbicide'
      : slot === 'insecticide-prophylactic' || slot === 'insecticide-scouted'
        ? 'insecticide'
        : slot === 'fungicide'
          ? 'fungicide'
          : 'fertilizer';
  return `No ${philosophy}-compliant ${family} in catalog covers the ${slot} slot.`;
}

/* ─── Public entrypoint ─────────────────────────────────────────────── */

export function planInputs(input: InputsPlanInput): InputsPlan {
  const blockById = new Map(input.blocks.map((b) => [b.id, b]));
  const stockOnHand: Record<string, StockAmount[]> = {};
  const stockLeft = new Map<string, StockAmount[]>();
  for (const st of input.existingStock) {
    if (!st.pluginId) continue;
    addStockAmount((stockOnHand[st.pluginId] ??= []), st.onHand, st.defaultUnit);
    let left = stockLeft.get(st.pluginId);
    if (!left) stockLeft.set(st.pluginId, (left = []));
    addStockAmount(left, st.onHand, st.defaultUnit);
  }
  for (const list of Object.values(stockOnHand)) {
    for (const b of list) b.amount = round2(b.amount);
  }
  const allApplications: InputsPlanApplication[] = [];
  const allScoutTasks: InputsPlanScoutTask[] = [];
  const allWarnings: PlannerWarning[] = [];
  const beds = planBeds(input);
  const noHerbicideTiming: string[] = [];
  const herbicidesAllowed = input.seasonSetup.weedStrategy !== 'cultivate-first';

  for (const planting of input.plantings) {
    const block = blockById.get(planting.blockId);
    const crop = input.cropPlugins[planting.cropPluginId];
    if (!block || !crop) continue;

    const out = planForPlanting(planting, block, crop, input, stockLeft, beds.get(block.id));
    allApplications.push(...out.applications);
    allScoutTasks.push(...out.scoutTasks);
    allWarnings.push(...out.warnings);
    if (
      herbicidesAllowed &&
      crop.archetype !== 'cover-crop.termination' &&
      !(crop.sprayWindows ?? []).some((w) => isWeedPurpose(w.purpose))
    ) {
      noHerbicideTiming.push(planting.id);
    }
  }
  if (noHerbicideTiming.length > 0) {
    allWarnings.push({
      kind: 'no-herbicide-timing',
      plantingId: noHerbicideTiming[0],
      plantingIds: noHerbicideTiming
    });
  }

  const shoppingList = buildShoppingList(
    allApplications,
    input.existingStock.map((st) => ({
      pluginId: st.pluginId,
      onHand: st.onHand,
      unit: st.defaultUnit
    }))
  );

  return {
    applications: allApplications,
    scoutTasks: mergeScoutTasks(allScoutTasks, input),
    shoppingList,
    stockOnHand,
    warnings: dedupeWarnings(allWarnings, input),
    meta: {
      year: input.year,
      philosophy: input.seasonSetup.philosophy,
      weedStrategy: input.seasonSetup.weedStrategy,
      pestStrategy: input.seasonSetup.pestStrategy,
      fertilityApproach: input.seasonSetup.fertilityApproach,
      generatedAtMs: input.nowMs ?? Date.now()
    }
  };
}

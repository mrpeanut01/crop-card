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
import { nCreditForIntent } from '$lib/fertility/coverCropCredits';
import type {
  FertilityApproach,
  PestStrategy,
  Philosophy,
  SeasonSetup,
  WeedStrategy
} from '$lib/season/setup';

import { effectiveAcresFor } from '$lib/db/blocks';

/* ─── Tier comparators ──────────────────────────────────────────────── */

const WEED_TIER: Record<WeedStrategy, number> = {
  'cultivate-first': 0,
  'pre-emergence-ok': 1,
  'post-emergence-ok': 2
};

const PEST_TIER: Record<PestStrategy, number> = {
  minimal: 0,
  ipm: 1,
  preventive: 2
};

/** A spray window with `weedStrategyGate: G` emits when the season-setup
 *  tier is at least G. Absent gate = always emit (back-compat with v1
 *  plugins that lack the field). */
function weedGateAllows(gate: WeedStrategy | undefined, setup: WeedStrategy): boolean {
  if (!gate) return true;
  return WEED_TIER[setup] >= WEED_TIER[gate];
}

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
      cropFamily: string;
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
  /** Optional clock injection for tests. Defaults to `Date.now()`. */
  nowMs?: number;
}

/* ─── Helpers ───────────────────────────────────────────────────────── */

/** Soil-test N credit, lb/acre. Conservative: anything above an 8 ppm
 *  nitrate baseline credits 4 lb-N/acre per ppm. Mehlich-3 is the
 *  default lab method for our region; the multiplier is the Penn State
 *  PSNT crediting table simplification. */
function nCreditFromSoilTestLbPerAcre(test: SoilTest | undefined): number {
  if (!test || test.nitratePpm == null) return 0;
  return Math.max(0, (test.nitratePpm - 8) * 4);
}

function pCreditFromSoilTestLbPerAcre(test: SoilTest | undefined): number {
  if (!test || test.phosphorusPpm == null) return 0;
  // P2O5 credit: above 25 ppm Mehlich-3 P, credit 0.5 lb P2O5 per ppm.
  return Math.max(0, (test.phosphorusPpm - 25) * 0.5);
}

function kCreditFromSoilTestLbPerAcre(test: SoilTest | undefined): number {
  if (!test || test.potassiumPpm == null) return 0;
  // K2O credit: above 120 ppm Mehlich-3 K, credit 0.5 lb K2O per ppm.
  return Math.max(0, (test.potassiumPpm - 120) * 0.5);
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

/** Pick the first herbicide whose active-ingredient chemistry class
 *  matches the window's `chemistryClass` AND is allowed under the
 *  philosophy. */
function pickHerbicideForWindow(
  window: CropSprayWindow,
  pool: ReadonlyArray<HerbicidePlugin>,
  philosophy: Philosophy
): HerbicidePlugin | null {
  for (const h of pool) {
    if (!h.activeIngredients.some((ai) => ai.chemistryClass === window.chemistryClass)) continue;
    if (!isProductAllowed(h, philosophy)) continue;
    return h;
  }
  return null;
}

/** First philosophy-allowed plugin in the pool — used for insecticide /
 *  fungicide slots where the spray window doesn't constrain by
 *  chemistry class. */
function pickFirstAllowed<T extends Parameters<typeof isProductAllowed>[0]>(
  pool: ReadonlyArray<T>,
  philosophy: Philosophy
): T | null {
  for (const p of pool) {
    if (isProductAllowed(p, philosophy)) return p;
  }
  return null;
}

/** Pick a fertilizer whose analysis matches the requested nutrient
 *  emphasis. `'n'` prefers the highest-N fertilizer; `'balanced'` picks
 *  the first allowed with all three nutrients non-zero. */
function pickFertilizer(
  pool: ReadonlyArray<FertilizerPlugin>,
  philosophy: Philosophy,
  emphasis: 'n' | 'balanced',
  approach: FertilityApproach
): FertilizerPlugin | null {
  const allowed = pool.filter((p) => isProductAllowed(p, philosophy));
  if (allowed.length === 0) return null;

  // Approach gating: when the operator chose `compost-amendments`, prefer
  // `organic === true` products even if synthetic alternatives are
  // philosophy-allowed. `mixed` accepts anything.
  const approachFiltered =
    approach === 'compost-amendments' || approach === 'cover-crop-credits'
      ? allowed.filter((p) => p.organic === true)
      : allowed;

  const pool2 = approachFiltered.length > 0 ? approachFiltered : allowed;

  if (emphasis === 'n') {
    return [...pool2].sort((a, b) => b.analysis.n - a.analysis.n)[0] ?? null;
  }
  return pool2.find((p) => p.analysis.n > 0 && p.analysis.p > 0 && p.analysis.k > 0) ?? pool2[0];
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
  input: InputsPlanInput
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
    if (!weedGateAllows(window.weedStrategyGate, seasonSetup.weedStrategy)) continue;
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

    const { category, picked } = pickProductForPurpose(
      window,
      window.purpose,
      productPlugins,
      seasonSetup.philosophy
    );

    if (!picked) {
      const reason = reasonForEmptyPool(window.purpose, seasonSetup.philosophy);
      warnings.push({
        kind: 'no-compliant-product',
        plantingId: planting.id,
        slot: window.purpose,
        reason
      });
    }

    const rate = picked && 'ratePerAcre' in picked ? picked.ratePerAcre : undefined;

    applications.push({
      id: applicationId(planting.id, window.purpose, windowIndex++),
      plantingId: planting.id,
      blockId: planting.blockId,
      cropPluginId: planting.cropPluginId,
      slot: window.purpose,
      productPluginId: picked?.pluginId ?? null,
      productDisplayName: picked?.displayName ?? null,
      productCategory: category,
      windowStartMs: dates.startMs,
      windowEndMs: dates.endMs,
      applicationDateMs: dates.startMs,
      rateAmount: rate?.amount ?? null,
      rateUnit: rate?.unit ?? null,
      acres,
      totalAmount: picked && rate ? Math.round(rate.amount * acres * 100) / 100 : null,
      rationale: window.body ?? window.title
    });
  }

  /* 2. Pre-plant fertility (synthesized) ─────────────────────────── */

  const removal = FAMILY_REMOVAL_DEFAULTS[crop.cropFamily];
  if (!removal) {
    warnings.push({
      kind: 'missing-yield-goal',
      plantingId: planting.id,
      cropFamily: crop.cropFamily
    });
  } else if (plantingDateMs != null && acres > 0) {
    const test = latestSoilTest(soilTests, planting.blockId);
    const explicitCredits = sumCredits(fertilityCredits, planting.blockId, year);
    const soilCredits = {
      n: nCreditFromSoilTestLbPerAcre(test),
      p: pCreditFromSoilTestLbPerAcre(test),
      k: kCreditFromSoilTestLbPerAcre(test)
    };
    const deficit = {
      n: removal.nRemovalLbPerAcre - soilCredits.n - explicitCredits.n,
      p: removal.pRemovalLbPerAcre - soilCredits.p - explicitCredits.p,
      k: removal.kRemovalLbPerAcre - soilCredits.k - explicitCredits.k
    };

    const coverNCredit =
      seasonSetup.fertilityApproach === 'cover-crop-credits'
        ? nCreditForIntent(seasonSetup.coverCropIntent)
        : 0;
    if (coverNCredit > 0) {
      deficit.n = deficit.n - coverNCredit;
    }

    const totalDeficit = Math.max(0, deficit.n) + Math.max(0, deficit.p) + Math.max(0, deficit.k);

    if (totalDeficit > 0) {
      const emphasis = deficit.n >= deficit.p && deficit.n >= deficit.k ? 'n' : 'balanced';
      const fert = pickFertilizer(
        productPlugins.fertilizers,
        seasonSetup.philosophy,
        emphasis,
        seasonSetup.fertilityApproach
      );

      if (!fert) {
        warnings.push({
          kind: 'no-compliant-product',
          plantingId: planting.id,
          slot: 'pre-plant-fertility',
          reason: `No ${seasonSetup.philosophy}-compliant fertilizer in catalog for ${seasonSetup.fertilityApproach} approach.`
        });
      }

      const ratePerAcre = fert ? fertilizerRateFromDeficit(deficit, fert) : 0;
      const windowEnd = plantingDateMs - 7 * DAY_MS;
      const windowStart = plantingDateMs - 21 * DAY_MS;

      applications.push({
        id: applicationId(planting.id, 'pre-plant-fertility', 0),
        plantingId: planting.id,
        blockId: planting.blockId,
        cropPluginId: planting.cropPluginId,
        slot: 'pre-plant-fertility',
        productPluginId: fert?.pluginId ?? null,
        productDisplayName: fert?.displayName ?? null,
        productCategory: 'fertilizer',
        windowStartMs: windowStart,
        windowEndMs: windowEnd,
        applicationDateMs: windowStart,
        rateAmount: ratePerAcre || null,
        rateUnit: fert ? (fert.applicationRange?.unit?.replace('-per-acre', '') ?? 'lb') : null,
        acres,
        totalAmount: ratePerAcre > 0 ? Math.round(ratePerAcre * acres * 100) / 100 : null,
        rationale:
          `Pre-plant fertility budget: ` +
          `N ${Math.max(0, deficit.n).toFixed(0)} lb/ac, ` +
          `P₂O₅ ${Math.max(0, deficit.p).toFixed(0)} lb/ac, ` +
          `K₂O ${Math.max(0, deficit.k).toFixed(0)} lb/ac ` +
          `(${crop.cropFamily} removal at family default − soil credits − fertility credits` +
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
    const fert = pickFertilizer(
      productPlugins.fertilizers,
      seasonSetup.philosophy,
      'n',
      seasonSetup.fertilityApproach
    );

    if (!fert) {
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
    const sidedressRate = 40; // lb-N/acre conservative split application
    const productLbPerAcre =
      fert && fert.analysis.n > 0 ? Math.ceil(sidedressRate / (fert.analysis.n / 100)) : 0;

    applications.push({
      id: applicationId(planting.id, 'sidedress-n', 0),
      plantingId: planting.id,
      blockId: planting.blockId,
      cropPluginId: planting.cropPluginId,
      slot: 'sidedress-n',
      productPluginId: fert?.pluginId ?? null,
      productDisplayName: fert?.displayName ?? null,
      productCategory: 'fertilizer',
      windowStartMs: sidedressDateMs - 3 * DAY_MS,
      windowEndMs: sidedressDateMs + 7 * DAY_MS,
      applicationDateMs: sidedressDateMs,
      rateAmount: productLbPerAcre || null,
      rateUnit: 'lb',
      acres,
      totalAmount: productLbPerAcre > 0 ? Math.round(productLbPerAcre * acres * 100) / 100 : null,
      rationale: `Sidedress N (~40 lb-N/ac) at ${v6 ? `stage ${v6.code}` : `+${anchorDays}d`}; covers post-emergence demand peak for ${crop.cropFamily}.`
    });
  }

  /* 4. Cover-crop terminate (synthesized when coverCropIntent set) ── */

  if (
    seasonSetup.coverCropIntent !== 'none' &&
    plantingDateMs != null &&
    !(crop.sprayWindows ?? []).some((w) => w.purpose === 'cover-terminate')
  ) {
    const useHerbicide = seasonSetup.weedStrategy !== 'cultivate-first';
    let picked: HerbicidePlugin | null = null;
    if (useHerbicide) {
      picked = pickFirstAllowed(productPlugins.herbicides, seasonSetup.philosophy);
      if (!picked) {
        warnings.push({
          kind: 'no-compliant-product',
          plantingId: planting.id,
          slot: 'cover-terminate',
          reason: `No ${seasonSetup.philosophy}-compliant herbicide for cover-crop termination.`
        });
      }
    }
    const terminateDateMs = plantingDateMs - 21 * DAY_MS;
    applications.push({
      id: applicationId(planting.id, 'cover-terminate', 0),
      plantingId: planting.id,
      blockId: planting.blockId,
      cropPluginId: planting.cropPluginId,
      slot: 'cover-terminate',
      productPluginId: picked?.pluginId ?? null,
      productDisplayName:
        (picked?.displayName ?? useHerbicide) ? null : 'Mow + incorporate (no herbicide)',
      productCategory: 'herbicide',
      windowStartMs: terminateDateMs - 7 * DAY_MS,
      windowEndMs: terminateDateMs + 7 * DAY_MS,
      applicationDateMs: terminateDateMs,
      rateAmount: picked?.ratePerAcre.amount ?? null,
      rateUnit: picked?.ratePerAcre.unit ?? null,
      acres,
      totalAmount:
        picked && picked.ratePerAcre
          ? Math.round(picked.ratePerAcre.amount * acres * 100) / 100
          : null,
      rationale: useHerbicide
        ? `Terminate prior-year ${seasonSetup.coverCropIntent} cover crop ~3 weeks before planting.`
        : `Mow + incorporate ${seasonSetup.coverCropIntent} cover crop ~3 weeks before planting (cultivation-first weed strategy).`
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

interface PickedProduct {
  category: 'herbicide' | 'insecticide' | 'fungicide' | 'fertilizer';
  picked: HerbicidePlugin | InsecticidePlugin | FungicidePlugin | FertilizerPlugin | null;
}

function pickProductForPurpose(
  window: CropSprayWindow,
  purpose: SprayWindowPurpose,
  pools: InputsPlanInput['productPlugins'],
  philosophy: Philosophy
): PickedProduct {
  switch (purpose) {
    case 'burndown':
    case 'pre-emergent':
    case 'post-emergent':
    case 'cover-terminate':
      return {
        category: 'herbicide',
        picked: pickHerbicideForWindow(window, pools.herbicides, philosophy)
      };
    case 'insecticide-prophylactic':
    case 'insecticide-scouted':
      return {
        category: 'insecticide',
        picked: pickFirstAllowed(pools.insecticides, philosophy)
      };
    case 'fungicide':
      return { category: 'fungicide', picked: pickFirstAllowed(pools.fungicides, philosophy) };
    case 'sidedress-n':
    case 'sidedress-other':
      return {
        category: 'fertilizer',
        picked: pickFertilizer(pools.fertilizers, philosophy, 'n', 'mixed')
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

/* ─── Shopping list aggregation ─────────────────────────────────────── */

function buildShoppingList(
  applications: ReadonlyArray<InputsPlanApplication>,
  stock: ReadonlyArray<InputsPlanStockRef>
): InputsPlanShoppingItem[] {
  const byPlugin = new Map<
    string,
    {
      pluginId: string;
      category: InputsPlanShoppingItem['category'];
      displayName: string;
      unit: string;
      totalNeeded: number;
      appliesToPlantingIds: Set<string>;
    }
  >();

  for (const app of applications) {
    if (!app.productPluginId || app.totalAmount == null || !app.rateUnit) continue;
    const existing = byPlugin.get(app.productPluginId);
    if (existing) {
      existing.totalNeeded += app.totalAmount;
      existing.appliesToPlantingIds.add(app.plantingId);
    } else {
      byPlugin.set(app.productPluginId, {
        pluginId: app.productPluginId,
        category: app.productCategory,
        displayName: app.productDisplayName ?? app.productPluginId,
        unit: app.rateUnit,
        totalNeeded: app.totalAmount,
        appliesToPlantingIds: new Set([app.plantingId])
      });
    }
  }

  const onHandByPlugin = new Map<string, number>();
  for (const s of stock) {
    if (!s.pluginId) continue;
    onHandByPlugin.set(s.pluginId, (onHandByPlugin.get(s.pluginId) ?? 0) + s.onHand);
  }

  const items: InputsPlanShoppingItem[] = [];
  for (const {
    pluginId,
    category,
    displayName,
    unit,
    totalNeeded,
    appliesToPlantingIds
  } of byPlugin.values()) {
    const onHand = onHandByPlugin.get(pluginId) ?? 0;
    const shortfall = Math.max(0, Math.round((totalNeeded - onHand) * 100) / 100);
    items.push({
      pluginId,
      category,
      displayName,
      unit,
      totalNeeded: Math.round(totalNeeded * 100) / 100,
      onHand: Math.round(onHand * 100) / 100,
      shortfall,
      appliesToPlantingIds: [...appliesToPlantingIds].sort()
    });
  }

  // Sort by category then displayName for stable UI rendering.
  items.sort((a, b) => {
    if (a.category !== b.category) return a.category.localeCompare(b.category);
    return a.displayName.localeCompare(b.displayName);
  });
  return items;
}

/* ─── Public entrypoint ─────────────────────────────────────────────── */

export function planInputs(input: InputsPlanInput): InputsPlan {
  const blockById = new Map(input.blocks.map((b) => [b.id, b]));
  const allApplications: InputsPlanApplication[] = [];
  const allScoutTasks: InputsPlanScoutTask[] = [];
  const allWarnings: PlannerWarning[] = [];

  for (const planting of input.plantings) {
    const block = blockById.get(planting.blockId);
    const crop = input.cropPlugins[planting.cropPluginId];
    if (!block || !crop) continue;

    const out = planForPlanting(planting, block, crop, input);
    allApplications.push(...out.applications);
    allScoutTasks.push(...out.scoutTasks);
    allWarnings.push(...out.warnings);
  }

  const shoppingList = buildShoppingList(allApplications, input.existingStock);

  return {
    applications: allApplications,
    scoutTasks: allScoutTasks,
    shoppingList,
    warnings: allWarnings,
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

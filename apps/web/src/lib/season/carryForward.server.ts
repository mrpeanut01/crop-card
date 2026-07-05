/**
 * UC-47 — Full-data carry-forward orchestrator (SERVER-ONLY, Phase 28).
 *
 * `*.server.ts` guarantees SvelteKit refuses to bundle the `$lib/db/*`
 * chain into the client. This module reads the DB + plugin registry,
 * threads plain snapshots into the pure `carryForwardPlan.ts` logic, and —
 * when `apply` is set — writes the deterministic side effects (expiry
 * movements on the surviving-stock roll-forward, a carry-forward wizard
 * draft that pre-seeds the AllocationWizard block selection).
 *
 * Deterministic end-to-end (Invariant 7). No AI. No RULES_VERSION bump
 * (no safety-kernel rule changes here).
 */

import { listBlocks } from '$lib/db/blocks';
import { listCrops, type Crop } from '$lib/db/crops';
import { listLotsForItem, listStockItems, recordMovement } from '$lib/db/stock';
import { listSprayers } from '$lib/db/sprayers';
import { defaultCoverCredit } from '$lib/fertility/coverCropCredits';
import { resolveArchetype } from '$lib/plugins/schemas';
import type { CropPlugin } from '$lib/plugins/schemas';
import { getRegistry } from '$lib/server/registry';
import { frostDatesForYear } from '$lib/schedule/settings';
import { scheduleCandidacy, type ScheduleAssignmentInput } from '$lib/schedule/scheduleCandidacy';
import { saveDraft } from '$lib/wizard/drafts';
import { carryForward as carryForwardPhilosophy } from './setup.server';
import {
  buildCalibrationHandoff,
  buildRotationSuggestion,
  classifyStockCarry,
  clonePlantings,
  nCreditFromTerminatedCovers,
  summarizeCarryForward,
  type BlockRotationInput,
  type CarryForwardSeasonResult,
  type ClonedPlanting,
  type PlantingCloneCandidate,
  type PriorPlanting,
  type ScheduleWindowLite,
  type SprayerCalibrationSnapshot,
  type StockLotSnapshot,
  type TerminatedCoverSnapshot
} from './carryForwardPlan';
import type { SeasonSetup } from './setup';

export interface CarryForwardSeasonInput {
  fromYear: number;
  toYear: number;
  /** When true, writes the side effects (expiry movements + wizard draft).
   *  When false, this is a pure dry-run preview. */
  apply: boolean;
  /** Override "now" for deterministic tests. */
  nowMs?: number;
  /** Optional acting user id, stamped on the wizard draft. */
  actingUserId?: string;
}

export interface CarryForwardSeasonOutput extends CarryForwardSeasonResult {
  /** Philosophy carry-forward (the legacy 6-7 enums) folded into the same
   *  call so the operator's "Prep next season" is one action. */
  philosophy: SeasonSetup | null;
  /** Set when `apply` and an expiry movement was written to zero an
   *  expired lot. */
  applied: {
    expiryMovementsWritten: number;
    wizardDraftPlanId: string | null;
  } | null;
}

function pluginIndexFromRegistry(registryCrops: CropPlugin[]): Record<string, CropPlugin> {
  const idx: Record<string, CropPlugin> = {};
  for (const p of registryCrops) idx[p.pluginId] = p;
  return idx;
}

function familyOf(crop: Crop, pluginIndex: Record<string, CropPlugin>): string {
  return pluginIndex[crop.cropPluginId]?.cropFamily ?? 'unknown';
}

function archetypeOf(crop: Crop, pluginIndex: Record<string, CropPlugin>): string {
  const plug = pluginIndex[crop.cropPluginId];
  if (!plug) return 'unknown';
  return resolveArchetype(plug);
}

/** A planting belongs to `year` when its planting date falls in that
 *  calendar year. Undated (planned) plantings are attributed to the
 *  fromYear so drafts still clone. */
function inYear(crop: Crop, year: number): boolean {
  if (crop.plantingDate === null) return true;
  return new Date(crop.plantingDate).getFullYear() === year;
}

/** Async entry: resolves the plugin registry, then runs the deterministic
 *  orchestration. This is what the endpoint + loader call. `runCarryForward`
 *  is the sync core, split out so it can be exercised with an injected
 *  plugin index (no registry singleton). */
export async function carryForwardSeasonAsync(
  input: CarryForwardSeasonInput
): Promise<CarryForwardSeasonOutput> {
  const registry = await getRegistry();
  const pluginIndex = pluginIndexFromRegistry(registry.crops());
  return runCarryForward(input, pluginIndex);
}

/**
 * Deterministic orchestration given a resolved plugin index. Split out from
 * the async wrapper so it can be exercised without the registry singleton.
 */
export function runCarryForward(
  input: CarryForwardSeasonInput,
  pluginIndex: Record<string, CropPlugin>
): CarryForwardSeasonOutput {
  const nowMs = input.nowMs ?? Date.now();
  const { fromYear, toYear } = input;

  const philosophy = carryForwardPhilosophy(fromYear, toYear);

  const blocks = listBlocks();
  const allCrops = listCrops();
  const priorCrops = allCrops.filter((c) => inYear(c, fromYear));

  // ─── 1. Rotation suggestions ──────────────────────────────────────────
  // Build the per-family lookback map from the plugins actually planted.
  const lookbackByFamily: Record<string, number> = {};
  for (const c of priorCrops) {
    const plug = pluginIndex[c.cropPluginId];
    if (!plug) continue;
    const fam = plug.cropFamily;
    if (lookbackByFamily[fam] !== undefined) continue;
    const declared = plug.agronomy?.rotationLookbackYears;
    // Plugin-declared value wins; otherwise fall back to the family table.
    lookbackByFamily[fam] = declared ?? rotationLookbackFallback(fam);
  }

  const cropsByBlock = new Map<string, Crop[]>();
  for (const c of priorCrops) {
    const arr = cropsByBlock.get(c.blockId) ?? [];
    arr.push(c);
    cropsByBlock.set(c.blockId, arr);
  }

  const rotation = blocks.map((b) => {
    const priorPlantings: PriorPlanting[] = (cropsByBlock.get(b.id) ?? []).map((c) => ({
      cropPluginId: c.cropPluginId,
      cropFamily: familyOf(c, pluginIndex),
      varietyDisplayName: c.varietyDisplayName,
      archetype: archetypeOf(c, pluginIndex),
      plantingDateMs: c.plantingDate,
      status: c.status,
      quantityPlanted: c.quantityPlanted,
      quantityUnit: c.quantityUnit
    }));
    const rotInput: BlockRotationInput = {
      blockId: b.id,
      blockName: b.name,
      priorPlantings
    };
    return buildRotationSuggestion(rotInput, lookbackByFamily, fromYear, toYear);
  });

  // ─── 2. Stock roll-forward ────────────────────────────────────────────
  const lots: StockLotSnapshot[] = [];
  for (const item of listStockItems()) {
    for (const lot of listLotsForItem(item.id)) {
      lots.push({
        lotId: lot.id,
        stockItemId: item.id,
        displayName: item.displayName,
        category: item.category,
        balance: lot.balance,
        unit: item.defaultUnit,
        expiresAtMs: lot.expiresAt ?? null
      });
    }
  }
  const { lastSpringFrostMs } = frostDatesForYear(toYear);
  const stock = classifyStockCarry(lots, nowMs, lastSpringFrostMs);

  // ─── 3. Planting-template clone ───────────────────────────────────────
  // Re-validate shifted dates against the schedule candidacy window for the
  // new season, computed from frost dates + block occupancy of the toYear.
  const cloneCandidates: PlantingCloneCandidate[] = priorCrops.map((c) => ({
    blockId: c.blockId,
    cropPluginId: c.cropPluginId,
    varietyDisplayName: c.varietyDisplayName,
    cropFamily: familyOf(c, pluginIndex),
    archetype: archetypeOf(c, pluginIndex),
    plantingDateMs: c.plantingDate,
    status: c.status,
    quantityPlanted: c.quantityPlanted,
    quantityUnit: c.quantityUnit
  }));

  const windows = scheduleWindowsFor(cloneCandidates, pluginIndex, allCrops, toYear, nowMs);
  const clonedPlantings = clonePlantings(cloneCandidates, windows);

  // ─── 4. Calibration hand-off ──────────────────────────────────────────
  const sprayerSnaps: SprayerCalibrationSnapshot[] = listSprayers().map((s) => ({
    sprayerId: s.id,
    name: s.label,
    calibratedGpa: s.calibratedGpa,
    calibrationDateMs: s.calibrationDate ?? null,
    winterizedAtMs: s.winterizedAt ?? null
  }));
  // A calibration older than the start of the prior season is stale for the
  // new one.
  const { lastSpringFrostMs: fromSeasonStart } = frostDatesForYear(fromYear);
  const calibration = buildCalibrationHandoff(sprayerSnaps, fromSeasonStart);

  // ─── 5. Cover-crop N-credit re-key onto actual terminated covers ──────
  const terminatedCovers: TerminatedCoverSnapshot[] = priorCrops.map((c) => ({
    blockId: c.blockId,
    cropPluginId: c.cropPluginId,
    nCreditLbPerAcre: defaultCoverCredit(c.cropPluginId)?.nLbPerAcre ?? null,
    archetype: archetypeOf(c, pluginIndex),
    status: c.status
  }));
  const nCredits = nCreditFromTerminatedCovers(terminatedCovers);

  const result = summarizeCarryForward({
    fromYear,
    toYear,
    rotation,
    stock,
    clonedPlantings,
    calibration,
    nCredits
  });

  // ─── Side effects (apply only) ────────────────────────────────────────
  let applied: CarryForwardSeasonOutput['applied'] = null;
  if (input.apply) {
    const itemById = new Map(listStockItems().map((i) => [i.id, i]));
    let expiryMovementsWritten = 0;
    for (const dec of stock) {
      if (dec.disposition !== 'expired') continue;
      const item = itemById.get(dec.stockItemId);
      if (!item) continue;
      // Zero out the expired lot with a negative movement tagged 'expiry'.
      try {
        recordMovement({
          stockLotId: dec.lotId,
          delta: -Math.abs(dec.balance),
          unit: item.defaultUnit,
          reason: 'expiry',
          performedById: input.actingUserId,
          occurredAt: nowMs,
          notes: `UC-47 carry-forward ${fromYear}→${toYear}: expired lot cleared.`
        });
        expiryMovementsWritten += 1;
      } catch {
        // A unit mismatch or missing lot shouldn't abort the whole prep —
        // the classification still surfaces the lot in the UI.
      }
    }

    const wizardDraftPlanId = seedCarryForwardDraft(toYear, clonedPlantings, input.actingUserId);
    applied = { expiryMovementsWritten, wizardDraftPlanId };
  }

  return { ...result, philosophy, applied };
}

/** Family plant-back fallback used when a plugin omits the value. Local copy
 *  of the family table's default so this module doesn't over-couple. */
function rotationLookbackFallback(family: string): number {
  // Conservative Extension-guideline defaults; solanaceae/brassica/cucurbit
  // carry a multi-year plant-back, most others one fallow year.
  const table: Record<string, number> = {
    solanaceae: 3,
    brassica: 3,
    cucurbit: 2,
    legume: 2,
    corn: 2,
    'root-crop': 2
  };
  return table[family] ?? 1;
}

/** Build re-validated schedule windows for the clone. Mirrors the wizard's
 *  scheduleCandidacy call: one assignment per (block, crop) candidate. */
function scheduleWindowsFor(
  candidates: readonly PlantingCloneCandidate[],
  pluginIndex: Record<string, CropPlugin>,
  existingCrops: readonly Crop[],
  toYear: number,
  nowMs: number
): ScheduleWindowLite[] {
  const frostDates = frostDatesForYear(toYear);
  const assignments: ScheduleAssignmentInput[] = candidates
    .filter((c) => c.status === 'harvested' || c.status === 'active')
    .map((c, i) => ({
      // stockItemId isn't meaningful for a planting clone; use a synthetic
      // key so scheduleCandidacy's output can be matched back by index.
      stockItemId: `clone-${i}`,
      blockId: c.blockId,
      cropPluginId: c.cropPluginId,
      varietyDisplayName: c.varietyDisplayName,
      plants: 1
    }));

  const windows = scheduleCandidacy({
    assignments,
    pluginIndex,
    existingCrops,
    frostDates,
    year: toYear,
    nowMs
  });

  return windows.map((w) => ({
    blockId: w.blockId,
    // scheduleCandidacy drops cropPluginId from the window; recover it from
    // the assignment by the same stockItemId key.
    cropPluginId: assignments.find((a) => a.stockItemId === w.stockItemId)?.cropPluginId ?? '',
    earliestMs: w.earliestMs,
    latestMs: w.latestMs
  }));
}

/**
 * Persist a carry-forward wizard draft so the operator's next AllocationWizard
 * run pre-seeds with the cloned blocks. The existing `wizard_drafts` payload
 * schema is bound to the live AllocationWizard shape (selectedBlockIds), so we
 * seed the block selection + a resume note listing the cloned plantings; the
 * full per-planting date/provenance clone is returned in the API response and
 * carried into the wizard in-memory (a dedicated persisted planting-draft
 * table is deferred — see PR notes).
 */
function seedCarryForwardDraft(
  toYear: number,
  clones: readonly ClonedPlanting[],
  actingUserId?: string
): string | null {
  if (clones.length === 0) return null;
  const planId = `carry-forward-${toYear}`;
  const selectedBlockIds = [...new Set(clones.map((c) => c.blockId))];
  const clampedCount = clones.filter((c) => c.clamped).length;
  const resumeNote =
    `${clones.length} planting${clones.length === 1 ? '' : 's'} carried from last season` +
    (clampedCount > 0
      ? ` (${clampedCount} date${clampedCount === 1 ? '' : 's'} re-checked).`
      : '.');

  try {
    saveDraft({
      planId,
      step: 'seeds',
      payload: {
        step: 'seeds',
        selectedSeeds: [],
        selectedBlockIds,
        chatDraft: '',
        resumeNote: resumeNote.slice(0, 280)
      },
      createdByUserId: actingUserId
    });
    return planId;
  } catch {
    return null;
  }
}

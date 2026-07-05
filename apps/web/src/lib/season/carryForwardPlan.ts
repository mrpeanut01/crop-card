/**
 * UC-47 — Full-data carry-forward + rotation advisor (Phase 28).
 *
 * PURE logic module — no DB, no `$lib/db/*`, no `$lib/server/*` imports.
 * Everything here is deterministic (Invariant 7: "AI assists, never gates"
 * — carry-forward is a fallback/deterministic path, never AI-gated). The
 * server orchestrator (`carryForward.server.ts`) reads the DB, resolves the
 * plugin registry, calls these functions with plain data, and writes
 * movements / drafts. Keeping the logic pure lets the rotation matrix +
 * expiry + clone tests run without `better-sqlite3`.
 *
 * Five deliverables, all deterministic:
 *   1. Rotation-aware block suggestions — same-family repeat flags +
 *      plugin/family `rotationLookbackYears` plant-back.
 *   2. Surviving-stock roll-forward classification — non-expired lots roll;
 *      lots expiring before/early next season flagged (not auto-discarded).
 *   3. Planting-template clone — prior accepted plantings shifted +1 year,
 *      re-validated against the schedule candidacy window, tagged
 *      `sourceProvenance='fallback'`.
 *   4. Calibration-reset hand-off — sprayers with stale/absent calibration
 *      surfaced for the UC-10 spring recalibration.
 *   5. Cover-crop N-credit re-key onto ACTUAL terminated cover-crop
 *      plantings (subsumes #228's real fix).
 */

const ONE_DAY_MS = 86_400_000;

// ─── 1. Rotation advisor ───────────────────────────────────────────────────

export type RotationSeverity = 'ok' | 'suggest' | 'warn';

export interface PriorPlanting {
  cropPluginId: string;
  cropFamily: string;
  varietyDisplayName: string;
  /** Archetype (resolved) — `cover-crop.termination` is special-cased for
   *  the N-credit re-key. */
  archetype: string;
  plantingDateMs: number | null;
  /** `status === 'harvested' | 'active' | 'planned'` etc. Only harvested /
   *  active plantings feed the rotation lookback + clone. */
  status: string;
  quantityPlanted?: number;
  quantityUnit?: string;
}

export interface BlockRotationInput {
  blockId: string;
  blockName: string;
  /** Prior-season plantings that occupied this block. */
  priorPlantings: PriorPlanting[];
}

export interface RotationSuggestion {
  blockId: string;
  blockName: string;
  severity: RotationSeverity;
  /** Families the prior season planted here (deduped). */
  priorFamilies: string[];
  /** Human-readable reason surfaced in the carry-forward UI. */
  message: string;
  /** Families to avoid replanting here next year (same-family + inside the
   *  plant-back lookback). */
  avoidFamilies: string[];
}

/** Defensible default plant-back lookback when the caller has no resolved
 *  value for a family (e.g. an unknown plugin). */
export function rotationLookbackDefault(): number {
  return 1;
}

/**
 * Build a per-block rotation suggestion. `lookbackByFamily` maps a crop
 * family → its resolved `rotationLookbackYears` (plugin > family > default),
 * threaded in by the server so this stays pure. `fromYear` is the season the
 * prior plantings belong to; `toYear` is the season we're prepping.
 *
 * A same-family repeat inside a >=3-year plant-back window is a `warn`; a
 * same-family repeat with a shorter lookback (the common vegetable default)
 * is a `suggest`; anything outside the window is `ok`.
 */
export function buildRotationSuggestion(
  block: BlockRotationInput,
  lookbackByFamily: Record<string, number>,
  fromYear: number,
  toYear: number
): RotationSuggestion {
  const relevant = block.priorPlantings.filter(
    (p) => p.status === 'harvested' || p.status === 'active' || p.status === 'planned'
  );
  const priorFamilies = [...new Set(relevant.map((p) => p.cropFamily))].sort();

  if (priorFamilies.length === 0) {
    return {
      blockId: block.blockId,
      blockName: block.blockName,
      severity: 'ok',
      priorFamilies: [],
      message: 'No prior-season planting on record — free to plant anything.',
      avoidFamilies: []
    };
  }

  const gapYears = toYear - fromYear;
  const avoidFamilies: string[] = [];
  let worst: RotationSeverity = 'ok';

  for (const fam of priorFamilies) {
    const lookback = lookbackByFamily[fam] ?? rotationLookbackDefault();
    // The prior planting sat here in `fromYear`. Replanting the same family
    // in `toYear` is a violation when `gapYears < lookback`.
    if (gapYears < lookback) {
      avoidFamilies.push(fam);
      const sev: RotationSeverity = lookback >= 3 ? 'warn' : 'suggest';
      if (sev === 'warn') worst = 'warn';
      else if (worst === 'ok') worst = 'suggest';
    }
  }

  if (avoidFamilies.length === 0) {
    return {
      blockId: block.blockId,
      blockName: block.blockName,
      severity: 'ok',
      priorFamilies,
      message: `Prior families (${priorFamilies.join(', ')}) are outside their plant-back window — safe to rotate back.`,
      avoidFamilies: []
    };
  }

  const famList = [...new Set(avoidFamilies)].sort().join(', ');
  const message =
    worst === 'warn'
      ? `Rotate away from ${famList} — replanting here risks disease/pest carryover inside the ${maxLookback(avoidFamilies, lookbackByFamily)}-year plant-back window.`
      : `Consider rotating away from ${famList} — planted here last season.`;

  return {
    blockId: block.blockId,
    blockName: block.blockName,
    severity: worst,
    priorFamilies,
    message,
    avoidFamilies: [...new Set(avoidFamilies)].sort()
  };
}

function maxLookback(families: string[], lookbackByFamily: Record<string, number>): number {
  let max = rotationLookbackDefault();
  for (const f of families) {
    const l = lookbackByFamily[f] ?? rotationLookbackDefault();
    if (l > max) max = l;
  }
  return max;
}

// ─── 2. Stock roll-forward ─────────────────────────────────────────────────

export type StockCarryDisposition = 'roll' | 'flag-expiring' | 'expired';

export interface StockLotSnapshot {
  lotId: string;
  stockItemId: string;
  displayName: string;
  category: string;
  balance: number;
  unit: string;
  expiresAtMs: number | null;
}

export interface StockCarryDecision {
  lotId: string;
  stockItemId: string;
  displayName: string;
  category: string;
  balance: number;
  unit: string;
  expiresAtMs: number | null;
  disposition: StockCarryDisposition;
  /** Why we classified it this way — surfaced in the UI and the movement note. */
  reason: string;
}

/**
 * Classify each surviving lot for the roll-forward. `nowMs` is the moment of
 * prep; `seasonStartMs` is the start of the next season (last spring frost
 * or Jan 1 of toYear — the server passes whichever it has). A lot already
 * past expiry is `expired`; a lot that will expire before or within the
 * first `flagWindowDays` of the new season is `flag-expiring` (roll it, but
 * warn the operator to use-first / reorder); everything else rolls clean.
 *
 * Zero-balance lots are skipped entirely (nothing to roll).
 */
export function classifyStockCarry(
  lots: readonly StockLotSnapshot[],
  nowMs: number,
  seasonStartMs: number,
  flagWindowDays = 45
): StockCarryDecision[] {
  const flagCutoff = seasonStartMs + flagWindowDays * ONE_DAY_MS;
  const out: StockCarryDecision[] = [];
  for (const lot of lots) {
    if (lot.balance <= 0) continue;
    let disposition: StockCarryDisposition;
    let reason: string;
    if (lot.expiresAtMs !== null && lot.expiresAtMs <= nowMs) {
      disposition = 'expired';
      reason = 'Already past expiry — do not carry into the new season.';
    } else if (lot.expiresAtMs !== null && lot.expiresAtMs <= flagCutoff) {
      disposition = 'flag-expiring';
      reason = 'Expires early next season — use first or reorder before planting.';
    } else {
      disposition = 'roll';
      reason = 'Non-expired — carries into the new season.';
    }
    out.push({
      lotId: lot.lotId,
      stockItemId: lot.stockItemId,
      displayName: lot.displayName,
      category: lot.category,
      balance: lot.balance,
      unit: lot.unit,
      expiresAtMs: lot.expiresAtMs,
      disposition,
      reason
    });
  }
  return out;
}

// ─── 3. Planting-template clone ────────────────────────────────────────────

export interface PlantingCloneCandidate {
  blockId: string;
  cropPluginId: string;
  varietyDisplayName: string;
  cropFamily: string;
  archetype: string;
  plantingDateMs: number | null;
  status: string;
  quantityPlanted?: number;
  quantityUnit?: string;
}

export interface ScheduleWindowLite {
  blockId: string;
  cropPluginId: string;
  earliestMs: number;
  latestMs: number;
}

export type CloneDateProvenance = 'shifted-plus-one-year' | 'clamped-to-window' | 'no-source-date';

export interface ClonedPlanting {
  blockId: string;
  cropPluginId: string;
  varietyDisplayName: string;
  cropFamily: string;
  archetype: string;
  /** Date shifted +1 year then clamped to the schedule window. Null when the
   *  source planting had no date (a planned-but-undated draft). */
  plantingDateMs: number | null;
  quantityPlanted?: number;
  quantityUnit?: string;
  /** Always `'fallback'` — Invariant 7: deterministic clone, never `'ai'`. */
  sourceProvenance: 'fallback';
  dateProvenance: CloneDateProvenance;
  /** True when the shifted date fell outside the re-validated window and was
   *  clamped — the UI surfaces this so the operator re-checks the date. */
  clamped: boolean;
}

/** Shift a ms timestamp forward one calendar year, preserving month/day. */
export function shiftOneYear(ms: number): number {
  const d = new Date(ms);
  return Date.UTC(
    d.getUTCFullYear() + 1,
    d.getUTCMonth(),
    d.getUTCDate(),
    d.getUTCHours(),
    d.getUTCMinutes(),
    d.getUTCSeconds()
  );
}

/**
 * Clone prior accepted plantings into next-season drafts. Each source date is
 * shifted +1 year, then clamped into the re-validated `[earliestMs, latestMs]`
 * schedule window for that (block, crop). Undated plantings clone with a null
 * date. Only `harvested` / `active` plantings clone (drafts/failed skip).
 */
export function clonePlantings(
  candidates: readonly PlantingCloneCandidate[],
  windows: readonly ScheduleWindowLite[]
): ClonedPlanting[] {
  const windowKey = (blockId: string, cropPluginId: string) => `${blockId} ${cropPluginId}`;
  const windowIndex = new Map<string, ScheduleWindowLite>();
  for (const w of windows) windowIndex.set(windowKey(w.blockId, w.cropPluginId), w);

  const out: ClonedPlanting[] = [];
  for (const c of candidates) {
    if (c.status !== 'harvested' && c.status !== 'active') continue;

    let plantingDateMs: number | null = null;
    let dateProvenance: CloneDateProvenance = 'no-source-date';
    let clamped = false;

    if (c.plantingDateMs !== null) {
      const shifted = shiftOneYear(c.plantingDateMs);
      const w = windowIndex.get(windowKey(c.blockId, c.cropPluginId));
      if (w) {
        if (shifted < w.earliestMs) {
          plantingDateMs = w.earliestMs;
          clamped = true;
          dateProvenance = 'clamped-to-window';
        } else if (shifted > w.latestMs) {
          plantingDateMs = w.latestMs;
          clamped = true;
          dateProvenance = 'clamped-to-window';
        } else {
          plantingDateMs = shifted;
          dateProvenance = 'shifted-plus-one-year';
        }
      } else {
        plantingDateMs = shifted;
        dateProvenance = 'shifted-plus-one-year';
      }
    }

    out.push({
      blockId: c.blockId,
      cropPluginId: c.cropPluginId,
      varietyDisplayName: c.varietyDisplayName,
      cropFamily: c.cropFamily,
      archetype: c.archetype,
      plantingDateMs,
      quantityPlanted: c.quantityPlanted,
      quantityUnit: c.quantityUnit,
      sourceProvenance: 'fallback',
      dateProvenance,
      clamped
    });
  }
  return out;
}

// ─── 4. Calibration-reset hand-off ─────────────────────────────────────────

export interface SprayerCalibrationSnapshot {
  sprayerId: string;
  name: string;
  calibratedGpa: number | null;
  calibrationDateMs: number | null;
  winterizedAtMs: number | null;
}

export interface CalibrationHandoff {
  sprayerId: string;
  name: string;
  /** True when the sprayer needs UC-10 recalibration before the new season. */
  needsRecalibration: boolean;
  reason: 'uncalibrated' | 'winterized' | 'stale' | 'current';
}

/**
 * Flag sprayers for the UC-45 winterization → UC-10 recalibration hand-off.
 * A sprayer needs recalibration when its calibration is absent (winterization
 * nulls it), or when the last calibration predates `staleBeforeMs` (the start
 * of the prior season by default — a calibration older than a full season is
 * stale for the new one).
 */
export function buildCalibrationHandoff(
  sprayers: readonly SprayerCalibrationSnapshot[],
  staleBeforeMs: number
): CalibrationHandoff[] {
  return sprayers.map((s) => {
    let needsRecalibration = false;
    let reason: CalibrationHandoff['reason'] = 'current';
    if (s.calibratedGpa === null || s.calibrationDateMs === null) {
      needsRecalibration = true;
      reason = s.winterizedAtMs !== null ? 'winterized' : 'uncalibrated';
    } else if (s.calibrationDateMs < staleBeforeMs) {
      needsRecalibration = true;
      reason = 'stale';
    }
    return { sprayerId: s.sprayerId, name: s.name, needsRecalibration, reason };
  });
}

// ─── 5. Cover-crop N-credit re-key onto actual terminated plantings ─────────

export interface TerminatedCoverSnapshot {
  blockId: string;
  cropPluginId: string;
  /** lb-N / acre this specific terminated cover crop delivers, resolved by
   *  the server from `defaultCoverCredit(pluginId)`. Null when the plugin
   *  isn't in the credit table (unknown cover crop → 0 default). */
  nCreditLbPerAcre: number | null;
  archetype: string;
  status: string;
}

export interface BlockNCredit {
  blockId: string;
  nCreditLbPerAcre: number;
  /** Cover-crop pluginIds credited on this block (usually one). */
  sourcePluginIds: string[];
}

/**
 * Re-key the cover-crop N-credit onto the ACTUAL terminated
 * `cover-crop.termination` plantings from the prior season, per block
 * (subsumes #228's real fix). The legacy path used the season-setup
 * *declared* `coverCropIntent` flat 65/0 lb-N; this instead credits each
 * block by the sum of the credits of the cover crops that were actually
 * grown + terminated there. Only `harvested` (terminated) or `active`
 * cover-crop plantings count.
 */
export function nCreditFromTerminatedCovers(
  covers: readonly TerminatedCoverSnapshot[]
): BlockNCredit[] {
  const byBlock = new Map<string, { total: number; ids: Set<string> }>();
  for (const c of covers) {
    if (c.archetype !== 'cover-crop.termination') continue;
    if (c.status !== 'harvested' && c.status !== 'active') continue;
    const credit = c.nCreditLbPerAcre ?? 0;
    const entry = byBlock.get(c.blockId) ?? { total: 0, ids: new Set<string>() };
    entry.total += credit;
    entry.ids.add(c.cropPluginId);
    byBlock.set(c.blockId, entry);
  }
  return [...byBlock.entries()]
    .map(([blockId, { total, ids }]) => ({
      blockId,
      nCreditLbPerAcre: total,
      sourcePluginIds: [...ids].sort()
    }))
    .sort((a, b) => a.blockId.localeCompare(b.blockId));
}

// ─── Aggregate result shape ────────────────────────────────────────────────

export interface CarryForwardSeasonResult {
  fromYear: number;
  toYear: number;
  rotation: RotationSuggestion[];
  stock: StockCarryDecision[];
  clonedPlantings: ClonedPlanting[];
  calibration: CalibrationHandoff[];
  nCredits: BlockNCredit[];
  /** Counts for the UI summary strip. */
  summary: {
    blocksWithRotationWarnings: number;
    lotsRolled: number;
    lotsFlagged: number;
    lotsExpired: number;
    plantingsCloned: number;
    sprayersNeedingRecalibration: number;
    blocksWithNCredit: number;
  };
}

export function summarizeCarryForward(
  input: Omit<CarryForwardSeasonResult, 'summary'>
): CarryForwardSeasonResult {
  return {
    ...input,
    summary: {
      blocksWithRotationWarnings: input.rotation.filter((r) => r.severity !== 'ok').length,
      lotsRolled: input.stock.filter((s) => s.disposition === 'roll').length,
      lotsFlagged: input.stock.filter((s) => s.disposition === 'flag-expiring').length,
      lotsExpired: input.stock.filter((s) => s.disposition === 'expired').length,
      plantingsCloned: input.clonedPlantings.length,
      sprayersNeedingRecalibration: input.calibration.filter((c) => c.needsRecalibration).length,
      blocksWithNCredit: input.nCredits.filter((n) => n.nCreditLbPerAcre > 0).length
    }
  };
}

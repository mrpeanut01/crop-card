/**
 * Schedule candidacy engine (Phase 20, B2).
 *
 * For each accepted (seed, block, plants) assignment, compute the valid
 * planting-date window from:
 *   - Frost dates (last spring + first fall) supplied by the caller
 *   - Plugin `plantingGuide.soilTempMinF` → derived hardiness class
 *   - Plugin `daysToMaturity.max` → backstop for "must mature before fall frost"
 *   - Block-time-availability: occupied windows from `existingCrops` planted
 *     on the same block (plantingDate + DTM + bed-turnover buffer)
 *
 * Pure function; no DB / no AI. The scheduler (B3) consumes these windows
 * as constraints and Claude picks dates within them.
 */

import type { CropPlugin } from '$lib/plugins/schemas';
import type { Crop } from '$lib/db/crops';

const ONE_DAY_MS = 86_400_000;
const BED_TURNOVER_DAYS = 10;

export type Hardiness = 'tender' | 'half-hardy' | 'hardy';

/** Family-keyed defaults when a plugin omits `soilTempMinF`. */
const FAMILY_HARDINESS: Record<string, Hardiness> = {
  corn: 'tender',
  cucurbit: 'tender',
  solanaceae: 'tender',
  legume: 'half-hardy',
  brassica: 'half-hardy',
  'leafy-green': 'half-hardy',
  alliums: 'hardy',
  'root-crop': 'hardy',
  'cereal-grain': 'hardy',
  forage: 'hardy',
  'culinary-herb': 'half-hardy',
  'cover-crop-grass': 'hardy',
  'cover-crop-legume': 'half-hardy'
};

const HARDINESS_DEFAULT_DTM: Record<Hardiness, number> = {
  tender: 75,
  'half-hardy': 65,
  hardy: 55
};

export interface ScheduleAssignmentInput {
  stockItemId: string;
  blockId: string;
  cropPluginId: string;
  varietyDisplayName: string;
  plants: number;
}

export interface ScheduleWindowInput {
  assignments: ReadonlyArray<ScheduleAssignmentInput>;
  pluginIndex: Record<string, CropPlugin>;
  existingCrops: ReadonlyArray<Crop>;
  frostDates: {
    /** `Date.UTC` ms — last spring frost. */
    lastSpringFrostMs: number;
    /** `Date.UTC` ms — first fall frost. */
    firstFallFrostMs: number;
  };
  /** Year being planned for. Used as the calendar frame. */
  year: number;
  /** Override "now" for tests. Production callers omit and we read Date.now(). */
  nowMs?: number;
}

export interface ScheduleWindow {
  stockItemId: string;
  blockId: string;
  /** Earliest plantable date in ms (epoch). Honors hardiness + soil temp. */
  earliestMs: number;
  /** Latest plantable date in ms — `firstFallFrost - DTM - 14d buffer`. */
  latestMs: number;
  /** Hardiness class derived for this assignment. Surfaced in the AI prompt
   *  so Claude can write friendly rationale ("frost-tender, so after May
   *  15th"). */
  hardiness: Hardiness;
  /** DTM upper bound used when computing `latestMs`. */
  dtmDaysMax: number;
  /** When the assigned block is already occupied during the natural
   *  planting window, this lists the sub-windows that ARE available.
   *  Format: `[startMs, endMs]` pairs; planting must start within one of
   *  these. Empty array means the natural [earliest, latest] is fully
   *  available. */
  freeSubWindows?: Array<[number, number]>;
}

export function scheduleCandidacy(input: ScheduleWindowInput): ScheduleWindow[] {
  const { assignments, pluginIndex, existingCrops, frostDates } = input;
  const out: ScheduleWindow[] = [];
  const occupiedByBlock = computeBlockOccupancy(existingCrops, pluginIndex);

  // Earliest plantable date is floored at "tomorrow" regardless of the
  // agronomic earliest — operators don't want the AI or the deterministic
  // fallback proposing dates that have already passed (e.g., picking Apr 21
  // when today is May 10). This keeps the suggested plan actionable.
  const nowMs = input.nowMs ?? Date.now();
  const startOfToday = new Date(nowMs);
  startOfToday.setHours(0, 0, 0, 0);
  const tomorrowMs = startOfToday.getTime() + ONE_DAY_MS;

  for (const a of assignments) {
    const plug = pluginIndex[a.cropPluginId];
    const hardiness = hardinessOf(plug);
    const dtmMax = plug?.daysToMaturity?.max ?? HARDINESS_DEFAULT_DTM[hardiness];

    const naturalEarliest = earliestPlantingMs(hardiness, frostDates.lastSpringFrostMs);
    const earliestMs = Math.max(naturalEarliest, tomorrowMs);
    // latestMs guards against unfit DTM; if the season has already passed
    // (today is past the natural latest), keep the floor at tomorrow so the
    // operator sees a future date with a clear "won't mature this year"
    // signal via the chat rather than a date in the past.
    const naturalLatest = frostDates.firstFallFrostMs - dtmMax * ONE_DAY_MS - 14 * ONE_DAY_MS;
    const latestMs = Math.max(earliestMs + ONE_DAY_MS, naturalLatest);

    const free = freeSubWindowsForBlock(
      occupiedByBlock[a.blockId] ?? [],
      earliestMs,
      latestMs
    );

    out.push({
      stockItemId: a.stockItemId,
      blockId: a.blockId,
      earliestMs,
      latestMs,
      hardiness,
      dtmDaysMax: dtmMax,
      freeSubWindows: free
    });
  }
  return out;
}

export function hardinessOf(plug: CropPlugin | undefined): Hardiness {
  if (!plug) return 'half-hardy';
  const tempMin = plug.plantingGuide?.soilTempMinF;
  if (typeof tempMin === 'number') {
    if (tempMin >= 65) return 'tender';
    if (tempMin >= 50) return 'half-hardy';
    return 'hardy';
  }
  return FAMILY_HARDINESS[plug.cropFamily] ?? 'half-hardy';
}

/** Earliest plantable date relative to the last spring frost. */
function earliestPlantingMs(hardiness: Hardiness, lastSpringFrostMs: number): number {
  switch (hardiness) {
    case 'tender':
      // 7d buffer after last frost so soil warms slightly.
      return lastSpringFrostMs + 7 * ONE_DAY_MS;
    case 'half-hardy':
      // 14d before last frost is the canonical "set out half-hardy" mark.
      return lastSpringFrostMs - 14 * ONE_DAY_MS;
    case 'hardy':
      // 42d before last frost — direct-seed peas, spinach, lettuce, etc.
      return lastSpringFrostMs - 42 * ONE_DAY_MS;
  }
}

interface OccupiedWindow {
  startMs: number;
  endMs: number;
}

/** Group existing crops by blockId and compute the [plant, harvest+turnover]
 *  windows they occupy. */
function computeBlockOccupancy(
  crops: ReadonlyArray<Crop>,
  pluginIndex: Record<string, CropPlugin>
): Record<string, OccupiedWindow[]> {
  const byBlock: Record<string, OccupiedWindow[]> = {};
  for (const c of crops) {
    if (!c.blockId || c.plantingDate == null) continue;
    if (c.status === 'archived' || c.status === 'failed' || c.status === 'harvested') continue;
    const plug = pluginIndex[c.cropPluginId];
    const dtm = plug?.daysToMaturity?.max ?? 90;
    const start = c.plantingDate;
    const end = start + (dtm + BED_TURNOVER_DAYS) * ONE_DAY_MS;
    const list = byBlock[c.blockId] ?? [];
    list.push({ startMs: start, endMs: end });
    byBlock[c.blockId] = list;
  }
  for (const id of Object.keys(byBlock)) {
    byBlock[id].sort((a, b) => a.startMs - b.startMs);
  }
  return byBlock;
}

/** Given occupied windows on a block and a [earliest, latest] interval,
 *  return the free sub-intervals within. Empty array signals "all open." */
function freeSubWindowsForBlock(
  occupied: ReadonlyArray<OccupiedWindow>,
  earliestMs: number,
  latestMs: number
): Array<[number, number]> {
  if (occupied.length === 0) return [];
  const free: Array<[number, number]> = [];
  let cursor = earliestMs;
  for (const w of occupied) {
    if (w.endMs <= earliestMs) continue;
    if (w.startMs >= latestMs) break;
    if (w.startMs > cursor) free.push([cursor, Math.min(w.startMs - ONE_DAY_MS, latestMs)]);
    cursor = Math.max(cursor, w.endMs);
  }
  if (cursor < latestMs) free.push([cursor, latestMs]);
  return free.filter(([s, e]) => e > s);
}

export function formatDateMs(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

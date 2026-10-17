/**
 * Phase 37D: the per-planting `EventContext.herb` the calendar and /today
 * loaders pass to the engine (R-18). Everything comes from settings the
 * loader already batches; the verdict is a function the caller supplies.
 * Pure and client-safe.
 */

import type { CropPlugin } from '$lib/plugins/schemas';
import type { PlantingRecord } from '$lib/db/blocks';
import type { SettingReader } from '$lib/db/settings';
import { resolveCropAgronomy } from '$lib/plugins/familyDefaults';
import { BRIEF_STORAGE_GOALS, type BriefStorageGoal } from '$lib/garden/preserving';
import type { LifecycleVerdict } from '$lib/garden/lifecycleTypes';
import { isHerbGardenCrop } from '$lib/garden/herbs';
import { SETTINGS_KEYS } from '$lib/schedule/constants';
import { normalizeFrost } from '$lib/schedule/farmLocation';
import type { HerbEventContext } from './herbEvents';

/** 37A's owner setting holding the garden brief as JSON. */
export const GARDEN_BRIEF_SETTING_KEY = 'garden_brief';

/** The settings the herb events need, for a loader's `getSettings` batch. */
export const HERB_CALENDAR_SETTING_KEYS: readonly string[] = [
  SETTINGS_KEYS.lastFrost,
  SETTINGS_KEYS.firstFrost,
  SETTINGS_KEYS.hardinessZone,
  SETTINGS_KEYS.hardinessZoneProvenance,
  GARDEN_BRIEF_SETTING_KEY
];

const GOAL_SET: ReadonlySet<string> = new Set(BRIEF_STORAGE_GOALS);
const GOAL_FIELD = /goal|storage|harvest|preserv|keep/i;

function goalOf(v: unknown): BriefStorageGoal | null {
  if (typeof v === 'string') return GOAL_SET.has(v) ? (v as BriefStorageGoal) : null;
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    for (const k of ['goal', 'method', 'value', 'id']) {
      const g = goalOf(o[k]);
      if (g) return g;
    }
  }
  return null;
}

function collectGoals(node: unknown, out: Set<BriefStorageGoal>, depth: number): void {
  if (depth > 4 || !node || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    for (const item of node) collectGoals(item, out, depth + 1);
    return;
  }
  for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
    if (GOAL_FIELD.test(key)) {
      const list = Array.isArray(value)
        ? value
        : value && typeof value === 'object' && Array.isArray((value as { value?: unknown }).value)
          ? ((value as { value: unknown[] }).value as unknown[])
          : [];
      for (const item of list) {
        const g = goalOf(item);
        if (g) out.add(g);
      }
    }
    if (value && typeof value === 'object') collectGoals(value, out, depth + 1);
  }
}

/**
 * The storage goals in the saved brief. Reads the goal lists of 37A's brief
 * JSON (any list under a goal, storage, harvest or preserving key whose
 * items are goal ids or objects naming one), so the calendar keeps working
 * while 37A's schema settles; no brief or an unreadable one has no goals.
 */
export function briefGoalsFromSetting(raw: string | null | undefined): Set<BriefStorageGoal> {
  const out = new Set<BriefStorageGoal>();
  if (!raw) return out;
  try {
    collectGoals(JSON.parse(raw), out, 0);
  } catch {
    return out;
  }
  return out;
}

export type HerbVerdictResolver = (
  crop: CropPlugin,
  planting: Pick<PlantingRecord, 'varietyDisplayName'>
) => LifecycleVerdict | null;

/**
 * The R-17 subset of 37B's `lifecycleHere` that needs no zone data: a
 * plugin's own annual or biennial, tagged `fallback` because no lifecycle
 * is sourced yet. A perennial reads `unknown` (no herb carries
 * `winterHardyToZone`, R-25) and a family default is `unknown`. The
 * integrator swaps this for `lifecycleHere(plugin, farmZone)`.
 */
export function interimLifecycleVerdict(crop: CropPlugin): LifecycleVerdict {
  const agronomy = resolveCropAgronomy(crop);
  if (agronomy.source.lifecycle !== 'plugin')
    return { lifecycle: 'unknown', provenance: 'fallback' };
  if (agronomy.lifecycle === 'annual') return { lifecycle: 'annual', provenance: 'fallback' };
  if (agronomy.lifecycle === 'biennial') return { lifecycle: 'biennial', provenance: 'fallback' };
  return { lifecycle: 'unknown', provenance: 'fallback' };
}

export interface HerbCalendarInputs {
  goals: ReadonlySet<BriefStorageGoal>;
  frost: HerbEventContext['frost'];
  verdictFor: HerbVerdictResolver;
}

export function herbCalendarInputs(
  read: SettingReader,
  verdictFor: HerbVerdictResolver = (crop) => interimLifecycleVerdict(crop)
): HerbCalendarInputs {
  return {
    goals: briefGoalsFromSetting(read(GARDEN_BRIEF_SETTING_KEY)),
    frost: {
      lastMmDd: normalizeFrost(read(SETTINGS_KEYS.lastFrost)),
      firstMmDd: normalizeFrost(read(SETTINGS_KEYS.firstFrost))
    },
    verdictFor
  };
}

/** The engine's `herb` context for one planting, or undefined when it is
 *  not an herb garden crop. */
export function herbContextFor(
  planting: Pick<PlantingRecord, 'cropPluginId' | 'varietyDisplayName'>,
  crop: CropPlugin,
  inputs: HerbCalendarInputs
): HerbEventContext | undefined {
  if (!isHerbGardenCrop(planting.cropPluginId)) return undefined;
  return {
    lifecycle: inputs.verdictFor(crop, planting)?.lifecycle ?? null,
    goals: inputs.goals,
    frost: inputs.frost
  };
}

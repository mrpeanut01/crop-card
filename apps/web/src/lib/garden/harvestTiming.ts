/** #867: when to cut an herb for the way the owner wants to keep it ("For
 *  drying: Cut just before it flowers."). The stage is plugin data quoted
 *  from a source (`harvestTiming`, gated by `harvestTimingQuoteGaps`); the
 *  words are the app's, in English and Spanish. A line shows only for a
 *  method the garden brief's storage goals name, and only on a crop that
 *  carries a row: there is no family default (rulings DH-1 to DH-8 in
 *  docs/design/phase-37-followups/drying-hint.md). Pure and client-safe. */

import { t, type MessageKey } from '$lib/i18n';
import type { CropHarvestTiming, HarvestTimingStage } from '$lib/plugins/schemas';
import {
  goalMethod,
  PRESERVING_METHODS,
  type BriefStorageGoal,
  type PreservingMethod
} from './preserving';

export interface HarvestTimingHint {
  method: PreservingMethod;
  stage: HarvestTimingStage;
}

/** The plugin's rows for the methods the brief's goals name, in method
 *  order. Pesto is judged as freezing (R-6); canning and jelly name no
 *  method, so they never add a line. */
export function harvestTimingHints(
  plugin: { harvestTiming?: readonly CropHarvestTiming[] } | null | undefined,
  goals: Iterable<BriefStorageGoal>
): HarvestTimingHint[] {
  const rows = plugin?.harvestTiming ?? [];
  if (rows.length === 0) return [];
  const wanted = new Set<PreservingMethod>();
  for (const g of goals) {
    const m = goalMethod(g);
    if (m) wanted.add(m);
  }
  return PRESERVING_METHODS.flatMap((method) => {
    if (!wanted.has(method)) return [];
    const row = rows.find((r) => r.method === method);
    return row ? [{ method, stage: row.stage }] : [];
  });
}

const FOR_KEY: Record<PreservingMethod, MessageKey> = {
  fresh: 'herbtiming.for.fresh',
  dry: 'herbtiming.for.dry',
  freeze: 'herbtiming.for.freeze',
  'freeze-dry': 'herbtiming.for.freezeDry',
  infuse: 'herbtiming.for.infuse'
};

const STAGE_KEY: Record<HarvestTimingStage, MessageKey> = {
  'before-bloom': 'herbtiming.stage.beforeBloom',
  'bloom-begins': 'herbtiming.stage.bloomBegins'
};

/** "For drying". English without a locale. */
export function harvestTimingLabel(method: PreservingMethod, locale?: string | null): string {
  return t(locale, FOR_KEY[method]);
}

/** "Cut just before it flowers." English without a locale. */
export function harvestTimingText(stage: HarvestTimingStage, locale?: string | null): string {
  return t(locale, STAGE_KEY[stage]);
}

/** Template keys of the tasks that are a cut: a harvest window scheduled
 *  from /today and the pantry's "Schedule the next cut". */
const HARVEST_TASK_KEY_PREFIXES = ['derived:harvest-window:', 'derived:pantry-cut:'] as const;

/** A task whose work is cutting the crop: its category says harvest, or it
 *  was scheduled from a harvest window or the pantry. */
export function isHarvestTask(task: {
  category?: string | null;
  pluginTemplateKey?: string | null;
}): boolean {
  if (task.category === 'harvest') return true;
  const key = task.pluginTemplateKey ?? '';
  return HARVEST_TASK_KEY_PREFIXES.some((p) => key.startsWith(p));
}

/** The hints for each harvest task's planting, keyed by planting id;
 *  plantings with no hint are left out. `pluginFor` returns the crop plugin
 *  for a plugin id, or nothing. */
export function harvestTimingByPlanting(
  tasks: ReadonlyArray<{
    cropId?: string | null;
    category?: string | null;
    pluginTemplateKey?: string | null;
  }>,
  cropPluginOf: ReadonlyMap<string, string>,
  pluginFor: (
    pluginId: string
  ) => { harvestTiming?: readonly CropHarvestTiming[] } | null | undefined,
  goals: Iterable<BriefStorageGoal>
): Record<string, HarvestTimingHint[]> {
  const wanted = [...goals];
  const out: Record<string, HarvestTimingHint[]> = {};
  if (wanted.length === 0) return out;
  for (const t of tasks) {
    if (!t.cropId || out[t.cropId] || !isHarvestTask(t)) continue;
    const pluginId = cropPluginOf.get(t.cropId);
    const hints = pluginId ? harvestTimingHints(pluginFor(pluginId), wanted) : [];
    if (hints.length) out[t.cropId] = hints;
  }
  return out;
}

/** Phase 37C sentences for the pantry, the harvest schedule panel and the
 *  card goal lines. Client-safe. With no locale every helper returns
 *  English. */

import { t, type MessageKey } from '$lib/i18n';
import type { GoalLine, GoalStatus } from './harvestSchedule';
import type { BriefStorageGoal, PreservingMethod } from './preserving';

const METHOD_KEY: Record<PreservingMethod, MessageKey> = {
  fresh: 'herbsc.method.fresh',
  dry: 'herbsc.method.dry',
  freeze: 'herbsc.method.freeze',
  'freeze-dry': 'herbsc.method.freezeDry',
  infuse: 'herbsc.method.infuse'
};

const METHOD_LOWER_KEY: Record<PreservingMethod, MessageKey> = {
  fresh: 'herbsc.methodLower.fresh',
  dry: 'herbsc.methodLower.dry',
  freeze: 'herbsc.methodLower.freeze',
  'freeze-dry': 'herbsc.methodLower.freezeDry',
  infuse: 'herbsc.methodLower.infuse'
};

const GOAL_KEY: Record<BriefStorageGoal, MessageKey> = {
  fresh: 'herbsc.goal.fresh',
  dry: 'herbsc.goal.dry',
  freeze: 'herbsc.goal.freeze',
  'freeze-dry': 'herbsc.goal.freezeDry',
  pesto: 'herbsc.goal.pesto',
  infuse: 'herbsc.goal.infuse',
  'can-or-jelly': 'herbsc.goal.canOrJelly'
};

const STATUS_KEY: Record<GoalStatus, MessageKey> = {
  'on-track': 'herbsc.status.onTrack',
  short: 'herbsc.status.short',
  'not-known': 'herbsc.status.notKnown'
};

const GOOD_KEY: Record<PreservingMethod, MessageKey> = {
  fresh: 'herbsc.reason.good.fresh',
  dry: 'herbsc.reason.good.dry',
  freeze: 'herbsc.reason.good.freeze',
  'freeze-dry': 'herbsc.reason.good.freezeDry',
  infuse: 'herbsc.reason.good.infuse'
};

const FAIR_KEY: Record<PreservingMethod, MessageKey> = {
  fresh: 'herbsc.reason.fair.fresh',
  dry: 'herbsc.reason.fair.dry',
  freeze: 'herbsc.reason.fair.freeze',
  'freeze-dry': 'herbsc.reason.fair.freezeDry',
  infuse: 'herbsc.reason.fair.infuse'
};

/** "Dried", for a picker or a heading. */
export function preservingMethodLabel(m: PreservingMethod, locale?: string | null): string {
  return t(locale, METHOD_KEY[m]);
}

/** "dried", inside a sentence. */
export function preservingMethodWord(m: PreservingMethod, locale?: string | null): string {
  return t(locale, METHOD_LOWER_KEY[m]);
}

/** ", dried": the tail a kept disposition's line gains. */
export function preservedAsSuffix(m: PreservingMethod, locale?: string | null): string {
  return t(locale, 'herbsc.disp.keptAs', { method: preservingMethodWord(m, locale) });
}

export function storageGoalLabel(g: BriefStorageGoal, locale?: string | null): string {
  return t(locale, GOAL_KEY[g]);
}

export function goalStatusLabel(s: GoalStatus, locale?: string | null): string {
  return t(locale, STATUS_KEY[s]);
}

/** The reason half of a goal line ("basil freezes fairly well"). */
export function goalReasonText(
  line: GoalLine,
  cropName: (pluginId: string) => string,
  locale?: string | null
): string {
  switch (line.reason) {
    case 'suitable-cut': {
      const method = line.method!;
      const crop = line.cropPluginId ? cropName(line.cropPluginId) : '';
      const key = line.suitability === 'fair' ? FAIR_KEY[method] : GOOD_KEY[method];
      return t(locale, key, { crop });
    }
    case 'needs-recipe':
      return t(locale, 'herbsc.reason.needsRecipe');
    case 'only-poor':
      return t(locale, 'herbsc.reason.onlyPoor');
    case 'no-cut':
      return t(locale, 'herbsc.reason.noCut');
    case 'nothing-planted':
      return t(locale, 'herbsc.reason.nothingPlanted');
    case 'no-data':
      return t(locale, 'herbsc.reason.noData');
  }
}

/** "Drying: on track, oregano dries well." The owner's target follows in
 *  their own words when they gave one. */
export function goalLineText(
  line: GoalLine,
  cropName: (pluginId: string) => string,
  locale?: string | null
): string {
  const text = t(locale, 'herbsc.goalLine', {
    goal: storageGoalLabel(line.goal, locale),
    status: goalStatusLabel(line.status, locale),
    reason: goalReasonText(line, cropName, locale)
  });
  return line.target
    ? t(locale, 'herbsc.goalLineTarget', { line: text, target: line.target })
    : text;
}

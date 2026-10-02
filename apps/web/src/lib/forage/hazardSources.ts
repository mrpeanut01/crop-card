import type { ForageHazardKind, ForageTrigger } from '$lib/plugins/schemas';

/**
 * Phase 33C (M-22): the entry in apps/web/scripts/forage-toxicity-sources.json
 * that each forage hazard trigger rests on. A trigger with no key here is
 * not sourced for that hazard and no plugin may carry it.
 */
export const FORAGE_TRIGGER_SOURCE_KEYS: Readonly<
  Record<ForageHazardKind, Partial<Record<ForageTrigger, string>>>
> = {
  'prussic-acid': {
    frost: 'prussicAcid.frostWait.killingFrostDays',
    drought: 'prussicAcid.regrowth.tillers',
    'young-regrowth': 'prussicAcid.regrowth.tillers',
    'heavy-nitrogen': 'nitrate.fertilizer.nPerCutting'
  },
  nitrate: {
    drought: 'nitrate.drought.afterRain',
    'heavy-nitrogen': 'nitrate.fertilizer.nPerCutting'
  }
};

/** M-23: entries whose `pluginIds` name crops that can carry each hazard.
 *  `prussicAcid.crops.notCyanogenic` and `relativeRisk` never count. */
export const FORAGE_CROP_ENTRY_PREFIX: Readonly<Record<ForageHazardKind, string>> = {
  'prussic-acid': 'prussicAcid.crops.',
  nitrate: 'nitrate.crops.'
};

export const FORAGE_CROP_ENTRIES_NEVER_COUNTED: readonly string[] = [
  'prussicAcid.crops.notCyanogenic',
  'prussicAcid.crops.relativeRisk'
];

/**
 * M-21: crop plugins that research mapped to a hazard but that carry no
 * `forageHazards`, each with the reason.
 */
export const FORAGE_PLUGIN_EXCLUSIONS: Readonly<Record<string, string>> = {
  'corn-bantam-sweet':
    'Sweet corn. The nitrate corn entry says its sources mean forage corn, not sweet corn.',
  'corn-sweet-bodacious':
    'Sweet corn. The nitrate corn entry says its sources mean forage corn, not sweet corn.',
  'turnip-hakurei':
    'The brassica nitrate source names no individual crop, so the mapping was an inference.',
  'turnip-purple-top-white-globe':
    'The brassica nitrate source names no individual crop, so the mapping was an inference.',
  'kale-lacinato':
    'The brassica nitrate source names no individual crop, so the mapping was an inference.',
  'kale-red-russian':
    'The brassica nitrate source names no individual crop, so the mapping was an inference.',
  'kale-winterbor-f1':
    'The brassica nitrate source names no individual crop, so the mapping was an inference.',
  'daikon-radish-cover':
    'The brassica nitrate source names no individual crop, so the mapping was an inference.',
  'tillage-radish-driller':
    'The brassica nitrate source names no individual crop, so the mapping was an inference.',
  'mustard-tillage-cover':
    'The brassica nitrate source names no individual crop, so the mapping was an inference.',
  'flax-grain-omega':
    'Prussic acid in flax rests on a single source, with no sourced trigger for it.',
  'white-clover-cover':
    'A single source names only "some varieties" of white clover, with no sourced trigger for it.'
};

/** A source taken from a page reader's extraction, which research says to
 *  re-read before shipping. It never counts toward the gate. */
export function isPageReaderSource(s: { note?: string }): boolean {
  return /page reader/i.test(s.note ?? '');
}

/** Per-application facts shared by the compliance exports (CSV, USDA CSV,
 *  VDACS PDF). Pure: callers resolve plugins and blocks first. Exports stay
 *  English. */

import { LOCK_WINDOW_MS } from '$lib/db/recordKinds';

const HOUR_MS = 60 * 60 * 1000;

/** FR-09: locked once stamped or once the 48 h window has passed, whether
 *  or not anything has stamped it yet. */
export function lockedNow(
  e: { occurredAt: number; lockedAt?: number },
  nowMs: number = Date.now()
): boolean {
  return e.lockedAt !== undefined || nowMs - e.occurredAt >= LOCK_WINDOW_MS;
}

type PluginLike =
  { type?: string; activeIngredients?: ReadonlyArray<{ name?: string }> } | undefined;

/** The label's active ingredient names ("tebuconazole"), never the
 *  mode-of-action group. Blank when the product is not in the library. */
export function activeIngredientNames(plugin: PluginLike): string {
  const names = (plugin?.activeIngredients ?? [])
    .map((a) => a.name?.trim() ?? '')
    .filter((n) => n.length > 0);
  return [...new Set(names)].join(' / ');
}

/** Mode-of-action groups, each labelled with its scheme so a bare "3" never
 *  reads as a chemistry class. */
export function modeOfActionLabels(
  kind: 'herbicide' | 'insecticide' | 'fungicide',
  groups: ReadonlyArray<string>
): string[] {
  const clean = [...new Set(groups.map((g) => g.trim()).filter((g) => g.length > 0))];
  if (kind === 'insecticide') return clean.map((g) => `IRAC ${g}`);
  if (kind === 'fungicide') return clean.map((g) => `FRAC ${g}`);
  return clean;
}

/** Restricted-entry interval in whole hours. The record's own stored
 *  clear time wins; otherwise the longest library value, but only when
 *  every product has one. Undefined means "not on file". */
export function reiHoursFor(
  occurredAt: number,
  reEntryClearAt: number | null | undefined,
  pluginHours: ReadonlyArray<number | null | undefined>
): number | undefined {
  if (typeof reEntryClearAt === 'number' && reEntryClearAt >= occurredAt) {
    return Math.round((reEntryClearAt - occurredAt) / HOUR_MS);
  }
  if (pluginHours.length === 0) return undefined;
  let max = -1;
  for (const h of pluginHours) {
    if (typeof h !== 'number' || !Number.isFinite(h) || h < 0) return undefined;
    max = Math.max(max, h);
  }
  return max;
}

export function reiText(hours: number | undefined): string {
  return hours === undefined ? 'Not on file' : `${hours} h`;
}

/** What the operator recorded as the target (a scout or disease
 *  observation). Never guessed from the label's target list. */
export function recordedTarget(ev: {
  scoutObservation?: { pest?: string } | null;
  diseaseObservation?: { disease?: string } | null;
}): string {
  return (ev.scoutObservation?.pest ?? ev.diseaseObservation?.disease ?? '').trim();
}

/** The crop treated: the record's own planting when it names one on this
 *  block, else every crop planted on the block. */
export function cropTreated(
  cropId: string | undefined,
  plantings: ReadonlyArray<{ id: string; cropPluginId: string; varietyDisplayName?: string }>,
  nameOf: (cropPluginId: string) => string | undefined
): string {
  const label = (p: (typeof plantings)[number]) =>
    nameOf(p.cropPluginId) ?? p.varietyDisplayName ?? p.cropPluginId;
  const own = cropId ? plantings.find((p) => p.id === cropId) : undefined;
  if (own) return label(own);
  return [...new Set(plantings.map(label))].slice(0, 3).join('; ');
}

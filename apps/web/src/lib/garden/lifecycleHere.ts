import { t } from '$lib/i18n';
import type { ZoneReach } from '$lib/climate/zone';
import type { CropLifecycle } from '$lib/plugins/schemas';
import type { LifecycleHere, LifecycleVerdict } from './lifecycleTypes';
import { SOURCED_LIFECYCLES, type SourcedLifecycle } from './lifecycleSources';

/** The slice of a crop plugin the verdict reads. */
export interface LifecyclePluginSlice {
  pluginId: string;
  agronomy?: { lifecycle?: string };
  winterHardyToZone?: string;
}

/** The farm zone as `farmZone()` and the card snapshot carry it. */
export interface LifecycleFarmZone {
  zone: string;
  provenance: 'data' | 'manual';
  reach?: ZoneReach;
}

export type LifecycleReason =
  | 'annual'
  | 'biennial'
  | 'perennial-here'
  | 'tender'
  | 'no-lifecycle'
  | 'no-farm-zone'
  | 'no-crop-zone';

/** `lifecycleHere()`'s answer with what the sentences need. */
export interface LifecycleDetail extends LifecycleVerdict {
  reason: LifecycleReason;
  /** The plugin's lifecycle is the quoted one. */
  sourced: boolean;
  /** The crop's coldest zone as the source prints it, when compared. */
  cropZone?: string;
  /** The farm zone the verdict read, for perennials. */
  farmZone?: { zone: string; provenance: 'data' | 'manual' };
}

const LIFECYCLES: ReadonlySet<string> = new Set<CropLifecycle>(['annual', 'biennial', 'perennial']);

/** Half-zone order: 1a is 2, 1b is 3, 13b is 27. A whole zone ("7") is its
 *  colder half (R-5). Anything else is null. */
export function zoneOrder(zone: string | null | undefined): number | null {
  if (typeof zone !== 'string') return null;
  const m = /^(1[0-3]|[1-9])([ab])?$/i.exec(zone.trim());
  if (!m) return null;
  return Number(m[1]) * 2 + (m[2]?.toLowerCase() === 'b' ? 1 : 0);
}

/** The plugin's own lifecycle (never a family default, R-17), as
 *  `resolveCropAgronomy` reads it when its source is `plugin`. */
function pluginLifecycle(plugin: LifecyclePluginSlice): CropLifecycle | null {
  const value = plugin.agronomy?.lifecycle;
  return value && LIFECYCLES.has(value) ? (value as CropLifecycle) : null;
}

/** The crop zone counts only when it is the quoted one, so a farm copy
 *  that claims a colder zone than its source never reads "comes back". */
function sourcedCropZone(
  plugin: LifecyclePluginSlice,
  sources: Readonly<Record<string, SourcedLifecycle>>
): string | null {
  const zone = plugin.winterHardyToZone;
  if (!zone || zoneOrder(zone) === null) return null;
  return sources[plugin.pluginId]?.winterHardyToZone === zone ? zone : null;
}

function verdict(
  lifecycle: LifecycleHere,
  reason: LifecycleReason,
  provenance: LifecycleVerdict['provenance'],
  sourced: boolean,
  extra: Partial<LifecycleDetail> = {}
): LifecycleDetail {
  return { lifecycle, provenance, reason, sourced, ...extra };
}

/**
 * What a crop is on this farm (Phase 37B, R-4, R-5, R-17).
 *
 * The lifecycle is the plugin's own; a family default reads `unknown`. It
 * is tagged `plugin` only when it is the quoted value, otherwise the same
 * verdict is tagged `fallback`. A perennial is compared with the farm
 * zone: colder than the crop's coldest zone reads `tender-perennial`. The
 * owner's typed zone is trusted and tags the comparison `manual`. A farm
 * zone from the wide lookup that equals the crop's adds `nearLimit`.
 */
export function lifecycleHere(
  plugin: LifecyclePluginSlice,
  farmZone: LifecycleFarmZone | null,
  sources: Readonly<Record<string, SourcedLifecycle>> = SOURCED_LIFECYCLES
): LifecycleDetail {
  const lifecycle = pluginLifecycle(plugin);
  if (!lifecycle) return verdict('unknown', 'no-lifecycle', 'fallback', false);
  const sourced = sources[plugin.pluginId]?.lifecycle === lifecycle;
  const tagged: LifecycleVerdict['provenance'] = sourced ? 'plugin' : 'fallback';
  if (lifecycle === 'annual') return verdict('annual', 'annual', tagged, sourced);
  if (lifecycle === 'biennial') return verdict('biennial', 'biennial', tagged, sourced);

  const farmOrder = farmZone ? zoneOrder(farmZone.zone) : null;
  if (!farmZone || farmOrder === null) {
    return verdict('unknown', 'no-farm-zone', 'fallback', sourced);
  }
  const seen = { zone: farmZone.zone, provenance: farmZone.provenance };
  const cropZone = sourcedCropZone(plugin, sources);
  if (!cropZone) {
    return verdict('unknown', 'no-crop-zone', 'fallback', sourced, { farmZone: seen });
  }
  const cropOrder = zoneOrder(cropZone)!;
  const compared: LifecycleVerdict['provenance'] = !sourced
    ? 'fallback'
    : farmZone.provenance === 'manual'
      ? 'manual'
      : 'plugin';
  if (farmOrder < cropOrder) {
    return verdict('tender-perennial', 'tender', compared, sourced, { cropZone, farmZone: seen });
  }
  const nearLimit =
    farmOrder === cropOrder && farmZone.provenance === 'data' && farmZone.reach === 'wide';
  return verdict('perennial-here', 'perennial-here', compared, sourced, {
    cropZone,
    farmZone: seen,
    ...(nearLimit ? { nearLimit: true } : {})
  });
}

const LABEL_KEY = {
  'perennial-here': 'herbsb.label.perennialHere',
  'tender-perennial': 'herbsb.label.tender',
  annual: 'herbsb.label.annual',
  biennial: 'herbsb.label.biennial',
  unknown: 'herbsb.label.unknown'
} as const;

/** The short label: "Perennial here", "Tender perennial", "Annual",
 *  "Biennial" or "Not known". */
export function lifecycleLabel(v: LifecycleVerdict, locale?: string | null): string {
  return t(locale, LABEL_KEY[v.lifecycle]);
}

const MAIN_KEY = {
  annual: 'herbsb.line.annual',
  biennial: 'herbsb.line.biennial',
  'perennial-here': 'herbsb.line.perennialHere',
  tender: 'herbsb.line.tender',
  'no-lifecycle': 'herbsb.line.noLifecycle',
  'no-farm-zone': 'herbsb.line.noFarmZone',
  'no-crop-zone': 'herbsb.line.noCropZone'
} as const;

/** Each sentence of the line, in order: the verdict, then "near its
 *  limit", "Not yet checked against a source" and "Using the zone you
 *  entered, 7b" where they apply. English without a locale. */
export function lifecycleSentences(v: LifecycleDetail, locale?: string | null): string[] {
  const out = [t(locale, MAIN_KEY[v.reason], { zone: v.cropZone ?? '' })];
  if (v.nearLimit) out.push(t(locale, 'herbsb.line.nearLimit'));
  if (v.reason !== 'no-lifecycle' && !v.sourced) out.push(t(locale, 'herbsb.line.notChecked'));
  if (v.farmZone?.provenance === 'manual') {
    out.push(t(locale, 'herbsb.line.typedZone', { zone: v.farmZone.zone }));
  }
  return out;
}

/** The whole line as one string. */
export function lifecycleLine(v: LifecycleDetail, locale?: string | null): string {
  return lifecycleSentences(v, locale).join(' ');
}

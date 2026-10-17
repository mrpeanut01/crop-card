import { farmZone } from '$lib/climate/zoneSettings.server';
import type { FarmZone } from '$lib/climate/zone';
import { isHerbGardenCrop } from '$lib/garden/herbs';
import {
  lifecycleHere,
  lifecycleLabel,
  lifecycleLine,
  type LifecycleDetail,
  type LifecycleFarmZone,
  type LifecyclePluginSlice
} from '$lib/garden/lifecycleHere';
import type { CropPlugin } from '$lib/plugins/schemas';
import { getRegistry } from './registry';

export function toLifecycleZone(zone: FarmZone | null | undefined): LifecycleFarmZone | null {
  if (!zone) return null;
  return {
    zone: zone.zone,
    provenance: zone.provenance,
    ...(zone.reach ? { reach: zone.reach } : {})
  };
}

/** The farm zone the verdict reads, loaded only when a perennial herb is
 *  on the page (the estimate may look up elevation). */
async function zoneFor(
  slices: LifecyclePluginSlice[],
  zone: LifecycleFarmZone | null | undefined
): Promise<LifecycleFarmZone | null> {
  if (zone !== undefined) return zone;
  if (!slices.some((s) => s.agronomy?.lifecycle === 'perennial')) return null;
  return toLifecycleZone(await farmZone());
}

/** Verdicts for the herbs among `plugins` (Phase 37B shows the line on
 *  herbs only), keyed by plugin id. */
export async function lifecycleVerdictsFor(
  plugins: Iterable<LifecyclePluginSlice | CropPlugin | null | undefined>,
  zone?: LifecycleFarmZone | null
): Promise<Record<string, LifecycleDetail>> {
  const herbs: LifecyclePluginSlice[] = [];
  for (const p of plugins) if (p && isHerbGardenCrop(p.pluginId)) herbs.push(p);
  if (!herbs.length) return {};
  const farm = await zoneFor(herbs, zone);
  const out: Record<string, LifecycleDetail> = {};
  for (const p of herbs) out[p.pluginId] = lifecycleHere(p, farm);
  return out;
}

/** The verdict for one crop plugin, or null when it is not a herb. */
export async function lifecycleVerdictFor(
  plugin: LifecyclePluginSlice | CropPlugin | null | undefined,
  zone?: LifecycleFarmZone | null
): Promise<LifecycleDetail | null> {
  if (!plugin) return null;
  return (await lifecycleVerdictsFor([plugin], zone))[plugin.pluginId] ?? null;
}

export interface LifecycleLineView {
  verdict: LifecycleDetail;
  label: string;
  line: string;
}

/** The lifecycle line for a herb in this Owner's library (37A's brief
 *  rows), or null for a crop that is not a herb or not in the library. */
export async function lifecycleLineFor(
  pluginId: string,
  locale?: string | null,
  zone?: LifecycleFarmZone | null
): Promise<LifecycleLineView | null> {
  if (!isHerbGardenCrop(pluginId)) return null;
  const rec = (await getRegistry()).get(pluginId);
  if (rec?.plugin.type !== 'crop') return null;
  const verdict = await lifecycleVerdictFor(rec.plugin, zone);
  if (!verdict) return null;
  return {
    verdict,
    label: lifecycleLabel(verdict, locale),
    line: lifecycleLine(verdict, locale)
  };
}

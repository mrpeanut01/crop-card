import type { CardFact } from '../model';
import type { FarmSnapshot, SnapshotHerbLifecycle } from '../snapshot';
import {
  lifecycleHere,
  lifecycleLine,
  type LifecycleDetail,
  type LifecyclePluginSlice
} from '$lib/garden/lifecycleHere';
import type { ResolvedOptions } from './common';

/** The verdict's plugin slice for a herb in the snapshot, or null. */
export function snapshotLifecycleSlice(
  herbLifecycle: Record<string, SnapshotHerbLifecycle> | undefined,
  pluginId: string
): LifecyclePluginSlice | null {
  const row = herbLifecycle?.[pluginId];
  if (!row) return null;
  return {
    pluginId,
    ...(row.lifecycle ? { agronomy: { lifecycle: row.lifecycle } } : {}),
    ...(row.winterHardyToZone ? { winterHardyToZone: row.winterHardyToZone } : {})
  };
}

/** Phase 37B: the herb's verdict from the snapshot and its zone. */
export function snapshotLifecycle(
  snapshot: FarmSnapshot,
  pluginId: string
): LifecycleDetail | null {
  const slice = snapshotLifecycleSlice(snapshot.herbLifecycle, pluginId);
  if (!slice) return null;
  const zone = snapshot.zone;
  return lifecycleHere(
    slice,
    zone
      ? { zone: zone.zone, provenance: zone.provenance, ...(zone.reach ? { reach: zone.reach } : {}) }
      : null
  );
}

/** The "Annual or perennial here" fact for a herb, or null. */
export function lifecycleFact(
  snapshot: FarmSnapshot,
  pluginId: string,
  opts: ResolvedOptions
): CardFact | null {
  const verdict = snapshotLifecycle(snapshot, pluginId);
  if (!verdict) return null;
  return {
    label: opts.tr('herbsb.title'),
    value: lifecycleLine(verdict, opts.prefs.locale),
    provenance: verdict.provenance
  };
}

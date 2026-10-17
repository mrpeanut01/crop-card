import type { SnapshotHerbLifecycle } from '$lib/cards/snapshot';
import { isHerbGardenCrop } from '$lib/garden/herbs';
import type { Plugin } from '$lib/plugins/schemas';

const LIFECYCLES = new Set(['annual', 'biennial', 'perennial']);

/** Phase 37B snapshot part: the herbs among the farm's crop plugins, with
 *  their own lifecycle and coldest zone (never a family default). */
export function herbLifecycleSnapshotPart(plugins: Iterable<Plugin | null | undefined>): {
  herbLifecycle?: Record<string, SnapshotHerbLifecycle>;
} {
  const out: Record<string, SnapshotHerbLifecycle> = {};
  for (const p of plugins) {
    if (!p || p.type !== 'crop' || !isHerbGardenCrop(p.pluginId)) continue;
    const lifecycle = p.agronomy?.lifecycle;
    out[p.pluginId] = {
      ...(lifecycle && LIFECYCLES.has(lifecycle) ? { lifecycle } : {}),
      ...(p.winterHardyToZone ? { winterHardyToZone: p.winterHardyToZone } : {})
    };
  }
  return Object.keys(out).length ? { herbLifecycle: out } : {};
}

/**
 * The designer page's data rebuilt from the Owner's offline card snapshot,
 * for a visit with no connection. Read-only: no catalog beyond the crops
 * already in this Area, no recipes, no companions, and `canEdit` is false.
 */

import type { FarmSnapshot } from '$lib/cards/snapshot';
import { isDesignable } from '$lib/farm/areaKinds';
import { rotationLookbackForFamily } from '$lib/plugins/familyDefaults';
import type { DesignerPageData } from './api';
import { designFromSnapshot } from './design';
import type { BedHistoryEntry } from './types';

export function designerDataFromSnapshot(
  snapshot: FarmSnapshot,
  areaId: string,
  opts: { seasonYear: number; role: string }
): DesignerPageData | null {
  const area = snapshot.areas.find((a) => a.id === areaId);
  if (!area || !isDesignable(area.kind)) return null;
  const design = designFromSnapshot(snapshot, areaId, {
    seasonYear: opts.seasonYear,
    readOnlyReason: 'offline'
  });
  if (!design) return null;

  const history: Record<string, BedHistoryEntry[]> = {};
  for (const p of design.plantings) {
    const crop = design.crops[p.cropPluginId];
    const when = p.plantingDateMs ?? p.harvestedAtMs;
    (history[p.blockId] ??= []).push({
      cropId: p.cropId,
      cropPluginId: p.cropPluginId,
      varietyDisplayName: p.varietyDisplayName,
      cropFamily: crop?.cropFamily ?? p.cropFamily,
      archetype: crop?.archetype ?? 'unknown',
      status: p.status,
      plantingDateMs: p.plantingDateMs,
      harvestedAtMs: p.harvestedAtMs,
      seasonYear: when != null ? new Date(when).getUTCFullYear() : opts.seasonYear
    });
  }

  const catalog = Object.values(design.crops).sort((a, b) =>
    a.displayName.localeCompare(b.displayName)
  );
  const lookbackByFamily: Record<string, number> = {};
  for (const c of catalog) lookbackByFamily[c.cropFamily] = rotationLookbackForFamily(c.cropFamily);

  return {
    design,
    history,
    catalog,
    companions: [],
    lookbackByFamily,
    areaKind: area.kind,
    recipes: [],
    canEdit: false,
    role: opts.role,
    seasons: [opts.seasonYear],
    activeYear: opts.seasonYear,
    offline: true
  };
}

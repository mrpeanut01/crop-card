/**
 * One place that turns a crop plugin and a planting date into projected
 * growth stages and harvest targets, for the calendar engine and /plan.
 *
 * - Winter-habit small grains (#629) take their stages from the /plan/wheat
 *   Zadoks timeline: fall stages count from sowing, stages from jointing on
 *   sit on the typical spring dates, so nothing lands in winter dormancy.
 * - Established perennial forage (#617) gets no day-from-planting stages:
 *   its family table counts from spring green-up, not from the seeding date,
 *   and cuttings are timed from the farm's own hay records instead.
 */

import type { CropPlugin, GrowthStageTable } from '$lib/plugins/schemas';
import { resolveGrowthStageTable } from '$lib/plugins/growthStageTemplates';
import { resolveCropAgronomy } from '$lib/plugins/familyDefaults';
import { buildZadoksTimeline, inferGrowthHabit } from '$lib/plan/smallGrain';
import {
  projectHarvestTargets,
  projectStages,
  type ProjectedHarvestTarget,
  type ProjectedStage
} from './stageProjection';

export interface CropStageProjection {
  table: GrowthStageTable;
  projected: ProjectedStage[];
  harvestTargets: ProjectedHarvestTarget[];
  /** Codes of stages placed on typical dates rather than counted from the
   *  plugin's own data (shown as typical timing). */
  typicalCodes: ReadonlySet<string>;
}

const FORAGE_FAMILIES: ReadonlySet<string> = new Set(['forage', 'forage-grass']);

function isEstablishedForage(crop: CropPlugin): boolean {
  if (crop.growthStageTable || crop.zadoksStages?.length) return false;
  if (crop.archetype === 'cover-crop.termination') return false;
  const forage = crop.archetype === 'forage-cutting-cycle' || FORAGE_FAMILIES.has(crop.cropFamily);
  return forage && resolveCropAgronomy(crop).isPerennial;
}

/** A fall-sown small grain that overwinters before jointing. */
export function isWinterSmallGrain(crop: CropPlugin): boolean {
  if (crop.archetype === 'cover-crop.termination') return false;
  const grain =
    crop.archetype === 'small-grain.zadoks' ||
    (crop.archetype === undefined && crop.cropFamily === 'cereal-grain');
  if (!grain) return false;
  return (
    inferGrowthHabit({
      pluginId: crop.pluginId,
      displayName: crop.displayName,
      daysToMaturity: crop.daysToMaturity
    }) === 'winter'
  );
}

function winterGrainProjection(
  plantMs: number,
  crop: CropPlugin,
  table: GrowthStageTable
): CropStageProjection | null {
  const timeline = buildZadoksTimeline(
    {
      pluginId: crop.pluginId,
      displayName: crop.displayName,
      daysToMaturity: crop.daysToMaturity,
      growthStageTable: table,
      zadoksStages: crop.zadoksStages
    },
    plantMs,
    'winter'
  );
  if (timeline.length === 0) return null;
  const byCode = new Map(table.stages.map((s) => [s.code, s]));
  const last = timeline[timeline.length - 1];
  const harvestStage = last.zadoks >= 83 ? last : undefined;
  const projected: ProjectedStage[] = timeline.map((s) => {
    const source = byCode.get(s.code);
    return {
      code: s.code,
      name: s.name,
      startMs: s.startMs,
      endMs: s.endMs,
      inspect: source?.inspect,
      bodyKind:
        source?.bodyKind ??
        (s.zadoks < 30 ? 'vegetative' : s.zadoks < 60 ? 'reproductive' : 'ripening'),
      isHarvestTargetStage: s === harvestStage
    };
  });
  const target = table.harvestTargets[0];
  const harvestTargets: ProjectedHarvestTarget[] = harvestStage
    ? [
        {
          stageCode: harvestStage.code,
          label: target?.label ?? 'Dry-storage grain',
          useCase: target?.useCase ?? 'dry-storage',
          startMs: harvestStage.startMs,
          endMs: harvestStage.endMs
        }
      ]
    : [];
  const typicalCodes = new Set(
    timeline.filter((s) => s.provenance === 'fallback').map((s) => s.code)
  );
  return { table, projected, harvestTargets, typicalCodes };
}

export function projectCropStages(plantMs: number, crop: CropPlugin): CropStageProjection | null {
  const table = resolveGrowthStageTable(crop);
  if (!table) return null;
  if (isEstablishedForage(crop)) return null;
  if (isWinterSmallGrain(crop)) return winterGrainProjection(plantMs, crop, table);
  const projected = projectStages(plantMs, table, crop.daysToMaturity);
  return {
    table,
    projected,
    harvestTargets: projectHarvestTargets(projected, table),
    typicalCodes: new Set()
  };
}

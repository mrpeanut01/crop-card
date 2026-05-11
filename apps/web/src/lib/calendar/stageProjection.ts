/**
 * Growth-stage projection (Phase 14 §growth-stages).
 *
 * Pure functions over plain data. Given a planting date, a resolved
 * GrowthStageTable, and the variety's actual DTM, produce projected stage
 * windows in epoch-ms; given the projected list, identify the current stage
 * and project harvest-target windows.
 *
 * Day-offset scaling: when the table came from a family default and carries
 * `referenceDtmDays`, the stage offsets are scaled by
 * `actualDtm.midpoint / referenceDtmDays`. Plugins that author their own table
 * without a referenceDtmDays are taken at face value.
 */

import type { GrowthStage, GrowthStageTable, HarvestTarget } from '$lib/plugins/schemas';
import type { PerennialStageTemplate } from '$lib/plugins/growthStageTemplates';

export interface ProjectedStage {
  code: string;
  name: string;
  startMs: number;
  endMs: number;
  inspect?: string;
  bodyKind?: GrowthStage['bodyKind'];
  isHarvestTargetStage: boolean;
}

export interface ProjectedHarvestTarget {
  stageCode: string;
  label: string;
  useCase?: HarvestTarget['useCase'];
  startMs: number;
  endMs: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;

export function projectStages(
  plantMs: number,
  table: GrowthStageTable,
  actualDtm?: { min: number; max: number }
): ProjectedStage[] {
  const scale = stageScaleFactor(table, actualDtm);
  const harvestCodes = new Set(table.harvestTargets.map((h) => h.stageCode));
  return table.stages.map((s) => {
    const minDays = s.daysFromPlanting.min * scale;
    const maxDays = s.daysFromPlanting.max * scale;
    return {
      code: s.code,
      name: s.name,
      startMs: plantMs + Math.round(minDays * DAY_MS),
      endMs: plantMs + Math.round(maxDays * DAY_MS),
      inspect: s.inspect,
      bodyKind: s.bodyKind,
      isHarvestTargetStage: harvestCodes.has(s.code)
    };
  });
}

function stageScaleFactor(
  table: GrowthStageTable,
  actualDtm?: { min: number; max: number }
): number {
  if (!table.referenceDtmDays || !actualDtm) return 1;
  const mid = (actualDtm.min + actualDtm.max) / 2;
  if (mid <= 0) return 1;
  return mid / table.referenceDtmDays;
}

export interface CurrentStageResult {
  current?: ProjectedStage;
  next?: ProjectedStage;
  daysIntoCurrent?: number;
  daysToNext?: number;
}

export function currentStage(projected: ProjectedStage[], now: number): CurrentStageResult {
  if (projected.length === 0) return {};
  // "Current" = the latest stage whose startMs <= now AND (no later stage has
  // started yet). Stages can overlap in source data; we pick the last-started.
  let current: ProjectedStage | undefined;
  for (const s of projected) {
    if (s.startMs <= now) current = s;
    else break;
  }
  const next = projected.find((s) => s.startMs > now);
  const result: CurrentStageResult = {};
  if (current) {
    result.current = current;
    result.daysIntoCurrent = Math.max(0, Math.floor((now - current.startMs) / DAY_MS));
  }
  if (next) {
    result.next = next;
    result.daysToNext = Math.max(0, Math.ceil((next.startMs - now) / DAY_MS));
  }
  return result;
}

export function projectHarvestTargets(
  projected: ProjectedStage[],
  table: GrowthStageTable
): ProjectedHarvestTarget[] {
  const byCode = new Map(projected.map((p) => [p.code, p]));
  const out: ProjectedHarvestTarget[] = [];
  for (const t of table.harvestTargets) {
    const window = byCode.get(t.stageCode);
    if (!window) continue;
    out.push({
      stageCode: t.stageCode,
      label: t.label,
      useCase: t.useCase,
      startMs: window.startMs,
      endMs: window.endMs
    });
  }
  return out;
}

/**
 * Project a perennial calendar template against a single calendar year.
 * Perennials ignore plantingDate; the operator sees this year's projected
 * stage windows on the schedule card.
 */
export function projectPerennialStages(
  template: PerennialStageTemplate,
  year: number
): ProjectedStage[] {
  const harvestCodes = new Set([template.harvestStageCode]);
  return template.stages.map((s) => ({
    code: s.code,
    name: s.name,
    startMs: dayOfYearToMs(year, s.dayOfYearStart),
    endMs: dayOfYearToMs(year, s.dayOfYearEnd) + 24 * 60 * 60 * 1000 - 1,
    inspect: s.inspect,
    bodyKind: s.bodyKind,
    isHarvestTargetStage: harvestCodes.has(s.code)
  }));
}

export function projectPerennialHarvestTargets(
  template: PerennialStageTemplate,
  projected: ProjectedStage[]
): ProjectedHarvestTarget[] {
  const target = projected.find((p) => p.code === template.harvestStageCode);
  if (!target) return [];
  return [
    {
      stageCode: template.harvestStageCode,
      label: template.harvestLabel,
      useCase: 'fresh-eating',
      startMs: target.startMs,
      endMs: target.endMs
    }
  ];
}

function dayOfYearToMs(year: number, dayOfYear: number): number {
  const d = new Date(year, 0, 1);
  d.setDate(d.getDate() + (dayOfYear - 1));
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

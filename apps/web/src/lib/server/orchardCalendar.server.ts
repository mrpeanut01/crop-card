/**
 * The orchard calendar for one planting (#562): which guide it gets and why
 * (OP-4), whether that calendar exists, was dropped, or is not written yet
 * (OC-6, OP-28), the season's low-input filter (OC-4) and the block's stage
 * mark. Reads only the active Owner's rows. Never gates a record.
 */

import { getBlock } from '$lib/db/blocks';
import { getCrop } from '$lib/db/crops';
import { getField } from '$lib/db/fields';
import { getAudienceOverride, getStageMarks } from '$lib/db/orchardCalendar';
import { getSetting } from '$lib/db/settings';
import { farmTimeZone } from '$lib/db/userProfile';
import { memberNamesByIds } from '$lib/db/users';
import { FARM_PROFILE_KEY } from '$lib/onboarding/profile';
import {
  calendarAudienceFor,
  calendarStatusFor,
  lowInputSeason,
  wantsSeasonalCalendar,
  type AudienceChoice
} from '$lib/orchard/calendar';
import type { OrchardCalendarPlugin } from '$lib/plugins/schemas';
import { loadSeasonSetup } from '$lib/season/setup.server';
import { farmYmd } from '$lib/server/degreeDays.server';
import { getDataKinds, getRegistry } from '$lib/server/registry';

export interface OrchardMarkView {
  stageId: string;
  markedAt: number;
  markedByName: string;
}

export interface OrchardPlantingView {
  cropId: string;
  cropPluginId: string;
  cropName: string;
  blockId: string;
  blockName: string;
  area: { id: string; name: string; kind: string } | null;
  year: number;
  audience: AudienceChoice;
  /** `none-wanted` is a crop that never shows a calendar line. */
  status: 'calendar' | 'out-of-date' | 'none' | 'none-wanted';
  calendar: OrchardCalendarPlugin | null;
  lowInput: boolean;
  mark: OrchardMarkView | null;
}

export function orchardYear(nowMs = Date.now()): number {
  return Number(farmYmd(nowMs, farmTimeZone()).slice(0, 4));
}

export async function loadOrchardPlantingView(
  cropId: string,
  opts: { now?: number; locale?: string | null } = {}
): Promise<OrchardPlantingView | null> {
  const crop = getCrop(cropId);
  if (!crop) return null;
  const block = getBlock(crop.blockId);
  if (!block) return null;
  const field = block.fieldId ? getField(block.fieldId) : undefined;
  const registry = await getRegistry();
  const plugin = registry.get(crop.cropPluginId)?.plugin;
  const cropFamily = plugin?.type === 'crop' ? plugin.cropFamily : null;
  const year = orchardYear(opts.now);
  const audience = calendarAudienceFor({
    override: field ? getAudienceOverride(field.id) : null,
    areaKind: field?.kind ?? null,
    farmProfile: getSetting(FARM_PROFILE_KEY) ?? null
  });
  const kinds = await getDataKinds();
  const found = calendarStatusFor(
    kinds.orchardCalendars.all(),
    kinds.droppedCalendars,
    crop.cropPluginId,
    audience.audience
  );
  const status =
    found.kind === 'calendar'
      ? 'calendar'
      : found.kind === 'out-of-date'
        ? 'out-of-date'
        : wantsSeasonalCalendar({ pluginId: crop.cropPluginId, cropFamily })
          ? 'none'
          : 'none-wanted';
  const calendar = found.kind === 'calendar' ? found.calendar : null;
  const stored = calendar ? getStageMarks(block.id, year)[calendar.pluginId] : undefined;
  const known = stored && calendar?.stages.some((s) => s.id === stored.stageId) ? stored : null;
  return {
    cropId: crop.id,
    cropPluginId: crop.cropPluginId,
    cropName: crop.varietyDisplayName,
    blockId: block.id,
    blockName: block.name,
    area: field ? { id: field.id, name: field.name, kind: field.kind } : null,
    year,
    audience,
    status,
    calendar,
    lowInput: lowInputSeason(loadSeasonSetup(year)),
    mark: known
      ? {
          stageId: known.stageId,
          markedAt: known.markedAt,
          markedByName: memberNamesByIds([known.markedBy], opts.locale).get(known.markedBy) ?? ''
        }
      : null
  };
}

/**
 * #593: the orchard part of the offline Card snapshot. Each planting gets the
 * line `/api/orchard/plantings/[id]` would give it (OP-4 guide, OR-9 out of
 * date, OR-2 marks whose stage left the calendar dropped), and only the
 * calendars those plantings resolve to ride along, already filtered for the
 * season (OR-8). Marks are read-only offline (ruling OS-2) and nothing here
 * feeds the insecticide form's bloom answer (OC-3, OS-3). A farm with no
 * orchard crop pays no query.
 */

import type {
  SnapshotArea,
  SnapshotBlock,
  SnapshotOrchard,
  SnapshotOrchardPlanting,
  SnapshotPlanting
} from '$lib/cards/snapshot';
import { listAudienceOverrides, listStageMarks } from '$lib/db/orchardCalendar';
import { getSetting } from '$lib/db/settings';
import { farmTimeZone } from '$lib/db/userProfile';
import { memberNamesByIds } from '$lib/db/users';
import { FARM_PROFILE_KEY } from '$lib/onboarding/profile';
import {
  calendarAudienceFor,
  calendarStatusFor,
  lowInputSeason,
  wantsSeasonalCalendar
} from '$lib/orchard/calendar';
import { orchardCalendarView, type OrchardCalendarView } from '$lib/orchard/calendarView';
import { loadSeasonSetup } from '$lib/season/setup.server';
import { orchardYear } from './orchardCalendar.server';
import { getDataKinds, getRegistry } from './registry';

export async function orchardSnapshotPart(input: {
  plantings: readonly SnapshotPlanting[];
  blocks: readonly SnapshotBlock[];
  areas: readonly SnapshotArea[];
  now: number;
  locale?: string | null;
}): Promise<SnapshotOrchard | undefined> {
  const registry = await getRegistry();
  const kinds = await getDataKinds();
  const calendars = kinds.orchardCalendars.all();
  const hosted = new Set(calendars.flatMap((c) => c.hostCropPluginIds));
  const familyOf = (pluginId: string) => {
    const plugin = registry.get(pluginId)?.plugin;
    return plugin?.type === 'crop' ? plugin.cropFamily : null;
  };
  const relevant = input.plantings.filter(
    (p) =>
      hosted.has(p.cropPluginId) ||
      wantsSeasonalCalendar({ pluginId: p.cropPluginId, cropFamily: familyOf(p.cropPluginId) })
  );
  if (relevant.length === 0) return undefined;

  const year = orchardYear(input.now);
  const lowInput = lowInputSeason(loadSeasonSetup(year));
  const overrides = listAudienceOverrides();
  const marksByBlock = listStageMarks(year);
  const farmProfile = getSetting(FARM_PROFILE_KEY) ?? null;
  const blockById = new Map(input.blocks.map((b) => [b.id, b]));
  const areaById = new Map(input.areas.map((a) => [a.id, a]));

  const views: Record<string, OrchardCalendarView> = {};
  const rows: SnapshotOrchardPlanting[] = [];
  const markers = new Set<string>();
  const pending: { row: SnapshotOrchardPlanting; markedBy: string }[] = [];

  for (const p of relevant) {
    const block = blockById.get(p.blockId);
    if (!block) continue;
    const area = block.areaId ? (areaById.get(block.areaId) ?? null) : null;
    const audience = calendarAudienceFor({
      override: area ? (overrides.get(area.id) ?? null) : null,
      areaKind: area?.kind ?? null,
      farmProfile
    });
    const found = calendarStatusFor(
      calendars,
      kinds.droppedCalendars,
      p.cropPluginId,
      audience.audience
    );
    if (
      found.kind === 'none' &&
      !wantsSeasonalCalendar({
        pluginId: p.cropPluginId,
        cropFamily: familyOf(p.cropPluginId)
      })
    )
      continue;
    const calendar = found.kind === 'calendar' ? found.calendar : null;
    if (calendar && !views[calendar.pluginId])
      views[calendar.pluginId] = orchardCalendarView(calendar, lowInput);
    const stored = calendar ? marksByBlock.get(block.id)?.[calendar.pluginId] : undefined;
    const known =
      stored && calendar?.stages.some((s) => s.id === stored.stageId) ? stored : undefined;
    const row: SnapshotOrchardPlanting = {
      cropId: p.id,
      status: found.kind,
      audience,
      calendarId: calendar?.pluginId ?? null,
      mark: known ? { stageId: known.stageId, markedAt: known.markedAt, markedByName: '' } : null
    };
    if (known) {
      markers.add(known.markedBy);
      pending.push({ row, markedBy: known.markedBy });
    }
    rows.push(row);
  }
  if (rows.length === 0) return undefined;
  if (markers.size) {
    const names = memberNamesByIds([...markers], input.locale);
    for (const { row, markedBy } of pending)
      if (row.mark) row.mark.markedByName = names.get(markedBy) ?? '';
  }
  return {
    year,
    timeZone: farmTimeZone(),
    lowInput,
    calendars: views,
    plantings: rows.sort((a, b) => a.cropId.localeCompare(b.cropId))
  };
}

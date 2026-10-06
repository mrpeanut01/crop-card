/**
 * PUT /api/orchard/plantings/[id]/stage  { stageId | null }
 *
 * Marks (or clears) the stage the planting's block is at, for the calendar
 * the planting resolves to now and this farm-local year (#562; stored as
 * `orchard_stage.<blockId>.<year>`, tagged `manual`). Owners and helpers
 * may; inspectors are read-only. A mark never gates a record: a pink or
 * bloom mark can only start the insecticide form at in bloom (OC-3).
 */

import { json, type RequestHandler } from '@sveltejs/kit';
import { t } from '$lib/i18n';
import { setStageMark } from '$lib/db/orchardCalendar';
import { orchardStagePutSchema } from '$lib/orchard/apiSchemas';
import { requireMutator } from '$lib/server/auth';
import { orchardSummary, readBody } from '$lib/server/orchardApi';
import { loadOrchardPlantingView } from '$lib/server/orchardCalendar.server';

export const _requestSchema = orchardStagePutSchema;

export const PUT: RequestHandler = async (event) => {
  const user = requireMutator(event);
  const locale = event.locals?.locale;
  const body = await readBody(event, orchardStagePutSchema);
  if (!body.ok) return body.response;
  const view = await loadOrchardPlantingView(event.params.id ?? '', { locale });
  if (!view) return json({ error: t(locale, 'orchardui.err.notFound') }, { status: 404 });
  if (!view.calendar)
    return json(
      { error: t(locale, 'orchardui.err.noCalendar'), code: 'NO_CALENDAR' },
      { status: 409 }
    );
  const { stageId } = body.data;
  if (stageId !== null && !view.calendar.stages.some((s) => s.id === stageId)) {
    return json(
      { error: t(locale, 'orchardui.err.unknownStage'), code: 'UNKNOWN_STAGE' },
      { status: 400 }
    );
  }
  setStageMark(
    view.blockId,
    view.year,
    view.calendar.pluginId,
    stageId === null ? null : { stageId, markedAt: Date.now(), markedBy: user.id }
  );
  const after = await loadOrchardPlantingView(view.cropId, { locale });
  return json(after ? orchardSummary(after) : null);
};

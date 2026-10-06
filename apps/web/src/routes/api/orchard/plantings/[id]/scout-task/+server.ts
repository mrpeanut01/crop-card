/**
 * POST /api/orchard/plantings/[id]/scout-task  { windowId }
 *
 * "Schedule a scouting task" on an orchard calendar window (OC-7): one task
 * for today on the planting's block, category `scout` (or `prune` for
 * cultural and sanitation windows), titled "Scout: <targets>" or "Check:
 * <stage>" by the app. Never a spray task, never the window's note. A second
 * tap in the same year answers 200 with `alreadyScheduled: true`. Owners and
 * helpers may.
 */

import { json, type RequestHandler } from '@sveltejs/kit';
import { t } from '$lib/i18n';
import { createTask, findTaskByTemplateKey } from '$lib/db/tasks';
import { farmTimeZone } from '$lib/db/userProfile';
import { orchardScoutTitle } from '$lib/orchard/appLines';
import { orchardScoutTaskSchema } from '$lib/orchard/apiSchemas';
import { scoutTaskCategory, scoutTaskTemplateKey, shownWindows } from '$lib/orchard/calendar';
import { requireMutator } from '$lib/server/auth';
import { farmYmd } from '$lib/server/degreeDays.server';
import { readBody } from '$lib/server/orchardApi';
import { loadOrchardPlantingView } from '$lib/server/orchardCalendar.server';
import { writeRecord } from '$lib/server/recordWrite';

export const _requestSchema = orchardScoutTaskSchema;

export const POST: RequestHandler = async (event) => {
  const user = requireMutator(event);
  const locale = event.locals?.locale;
  const body = await readBody(event, orchardScoutTaskSchema);
  if (!body.ok) return body.response;
  const view = await loadOrchardPlantingView(event.params.id ?? '', { locale });
  if (!view) return json({ error: t(locale, 'orchardui.err.notFound') }, { status: 404 });
  const calendar = view.calendar;
  if (!calendar)
    return json(
      { error: t(locale, 'orchardui.err.noCalendar'), code: 'NO_CALENDAR' },
      { status: 409 }
    );
  const found = calendar.stages
    .map((stage) => ({
      stage,
      window: shownWindows(calendar, stage, view.lowInput).find((w) => w.id === body.data.windowId)
    }))
    .find((x) => x.window);
  if (!found?.window) {
    return json(
      { error: t(locale, 'orchardui.err.unknownWindow'), code: 'UNKNOWN_WINDOW' },
      { status: 400 }
    );
  }
  const { stage, window } = found;
  const key = scoutTaskTemplateKey(calendar.pluginId, window.id, view.blockId, view.year);
  const today = Date.parse(farmYmd(Date.now(), farmTimeZone()));
  const out = writeRecord(event, () => {
    const existing = findTaskByTemplateKey(key);
    if (existing) return { task: existing, already: true };
    const task = createTask({
      title: orchardScoutTitle(calendar.pluginId, stage, window),
      kind: 'primary',
      cropId: view.cropId,
      blockId: view.blockId,
      scheduledFor: today,
      pluginTemplateKey: key,
      category: scoutTaskCategory(window),
      createdById: user.id
    });
    return { task, already: false };
  });
  return out.already
    ? json({ task: out.task, alreadyScheduled: true }, { status: 200 })
    : json({ task: out.task }, { status: 201 });
};

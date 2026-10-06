/** Shared pieces of the `/api/orchard/**` routes (#562). */

import { json, type RequestEvent } from '@sveltejs/kit';
import type { z } from 'zod';
import { t } from '$lib/i18n';
import type { OrchardPlantingView } from './orchardCalendar.server';
import type { OrchardSummary } from '$lib/orchard/summary';

export type { OrchardSummary };

export async function readBody<T>(
  event: RequestEvent,
  schema: z.ZodType<T>
): Promise<{ ok: true; data: T } | { ok: false; response: Response }> {
  let body: unknown;
  try {
    body = await event.request.json();
  } catch {
    return {
      ok: false,
      response: json(
        { error: t(event.locals?.locale, 'stockui.api.invalidJsonShort') },
        { status: 400 }
      )
    };
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return {
      ok: false,
      response: json(
        {
          error: t(event.locals?.locale, 'stockui.api.invalidRequest'),
          issues: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message }))
        },
        { status: 400 }
      )
    };
  }
  return { ok: true, data: parsed.data };
}

/** What a card panel needs: no windows, so no bee or label line. */
export function orchardSummary(view: OrchardPlantingView): OrchardSummary {
  const stage =
    view.calendar && view.mark
      ? (view.calendar.stages.find((s) => s.id === view.mark!.stageId) ?? null)
      : null;
  return {
    cropId: view.cropId,
    cropPluginId: view.cropPluginId,
    cropName: view.cropName,
    status: view.status,
    audience: view.audience,
    calendar: view.calendar
      ? {
          pluginId: view.calendar.pluginId,
          edition: view.calendar.edition,
          publicationId: view.calendar.guide.publicationId,
          title: view.calendar.guide.title
        }
      : null,
    stage: stage ? { id: stage.id, name: stage.name } : null,
    mark: view.mark,
    href: `/plan/orchard/${encodeURIComponent(view.cropId)}`
  };
}

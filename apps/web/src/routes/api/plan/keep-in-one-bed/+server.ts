import { json, type RequestHandler } from '@sveltejs/kit';
import { requireUser } from '$lib/server/auth';
import { getRegistry } from '$lib/server/registry';
import { t } from '$lib/i18n';
import { keepInOneBedRequestSchema } from '$lib/plan/keepInOneBed';
import { setKeepInOneBed } from '$lib/plan/keepInOneBed.server';

export const _requestSchema = keepInOneBedRequestSchema;

/** PUT /api/plan/keep-in-one-bed (Phase 35, R-15). The owner's standing
 *  choice to keep a crop in one bed in future plans. Never moves saved
 *  plantings. */
export const PUT: RequestHandler = async (event) => {
  const locale = event.locals?.locale;
  const user = requireUser(event);
  if (user.role !== 'owner') {
    return json({ error: t(locale, 'plan.split.err.ownerOnly') }, { status: 403 });
  }
  let body: unknown;
  try {
    body = await event.request.json();
  } catch {
    return json({ error: t(locale, 'plan.split.err.invalid') }, { status: 400 });
  }
  const parsed = keepInOneBedRequestSchema.safeParse(body);
  if (!parsed.success) {
    return json({ error: t(locale, 'plan.split.err.invalid') }, { status: 400 });
  }
  const registry = await getRegistry();
  const plugin = registry.get(parsed.data.cropPluginId);
  if (!plugin || plugin.plugin.type !== 'crop') {
    return json({ error: t(locale, 'plan.split.err.unknownCrop') }, { status: 400 });
  }
  return json({ cropPluginIds: setKeepInOneBed(parsed.data.cropPluginId, parsed.data.keep) });
};

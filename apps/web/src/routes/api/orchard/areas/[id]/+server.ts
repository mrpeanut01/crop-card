/**
 * GET /api/orchard/areas/[id]
 *
 * The orchard calendar summary for every current planting in an Area that
 * has, or should have, a seasonal calendar (#562), for the Area Card. Every
 * role may read it.
 */

import { json, type RequestHandler } from '@sveltejs/kit';
import { t } from '$lib/i18n';
import { listBlocks } from '$lib/db/blocks';
import { getField } from '$lib/db/fields';
import { requireUser } from '$lib/server/auth';
import { orchardSummary, type OrchardSummary } from '$lib/server/orchardApi';
import { loadOrchardPlantingView } from '$lib/server/orchardCalendar.server';
import { getDataKinds, getRegistry } from '$lib/server/registry';
import { wantsSeasonalCalendar } from '$lib/orchard/calendar';

export const GET: RequestHandler = async (event) => {
  requireUser(event);
  const locale = event.locals?.locale;
  const area = getField(event.params.id ?? '');
  if (!area) return json({ error: t(locale, 'orchardui.err.areaNotFound') }, { status: 404 });
  const plantings: OrchardSummary[] = [];
  const registry = await getRegistry();
  const hosted = new Set(
    (await getDataKinds()).orchardCalendars.all().flatMap((c) => c.hostCropPluginIds)
  );
  const relevant = (pluginId: string) => {
    const plugin = registry.get(pluginId)?.plugin;
    const cropFamily = plugin?.type === 'crop' ? plugin.cropFamily : null;
    return hosted.has(pluginId) || wantsSeasonalCalendar({ pluginId, cropFamily });
  };
  for (const b of listBlocks({ plantings: 'current' })) {
    if (b.fieldId !== area.id) continue;
    for (const p of b.plantings) {
      if (!relevant(p.cropPluginId)) continue;
      const view = await loadOrchardPlantingView(p.id, { locale });
      if (view && view.status !== 'none-wanted') plantings.push(orchardSummary(view));
    }
  }
  return json({ areaId: area.id, plantings });
};

/**
 * GET /api/blocks/:id/companions?cropPluginId=...
 *
 * Returns Three Sisters / future companion-system suggestions for the
 * planted crop family, using available registered crop plugins. Drives
 * the FR-15 Companion Advisor on /plan.
 */

import { json, type RequestHandler } from '@sveltejs/kit';
import { suggestCompanions } from '$lib/calendar/companions';
import type { CropPlugin } from '$lib/plugins/schemas';
import { getRegistry } from '$lib/server/registry';

export const GET: RequestHandler = async ({ params, url }) => {
  const cropPluginId = url.searchParams.get('cropPluginId');
  if (!params.id || !cropPluginId) {
    return json({ suggestions: [] });
  }

  const registry = await getRegistry();
  const planted = registry.get(cropPluginId);
  if (!planted || planted.plugin.type !== 'crop') {
    return json({ suggestions: [] });
  }

  const availableCrops = registry
    .all()
    .filter((r) => r.plugin.type === 'crop')
    .map((r) => r.plugin as CropPlugin);

  const suggestions = suggestCompanions((planted.plugin as CropPlugin).cropFamily, availableCrops);
  return json({ suggestions });
};

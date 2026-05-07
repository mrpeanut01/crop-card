/**
 * GET /api/plugins
 *
 * Returns the registry's crop and herbicide catalogs so the spray-flow UI
 * can populate selectors. Hashes are surfaced for audit-trail display.
 */

import { json, type RequestHandler } from '@sveltejs/kit';
import { getRegistry } from '$lib/server/registry';

export const GET: RequestHandler = async () => {
  const registry = await getRegistry();
  const crops = registry
    .all()
    .filter((r) => r.plugin.type === 'crop')
    .map((r) => ({
      pluginId: r.plugin.pluginId,
      displayName: r.plugin.displayName,
      cropFamily: r.plugin.type === 'crop' ? r.plugin.cropFamily : undefined,
      hash: r.hash
    }));

  const herbicides = registry
    .all()
    .filter((r) => r.plugin.type === 'herbicide')
    .map((r) => {
      if (r.plugin.type !== 'herbicide') throw new Error('unreachable');
      const h = r.plugin;
      return {
        pluginId: h.pluginId,
        displayName: h.displayName,
        applicationTiming: h.applicationTiming,
        chemistryClasses: Array.from(
          new Set(h.activeIngredients.map((ai) => ai.chemistryClass))
        ),
        ratePerAcre: h.ratePerAcre,
        gpaCalibration: h.gpaCalibration,
        tankMixOrder: h.tankMixOrder,
        requiresAMS: h.requiresAMS ?? false,
        deconRequired: h.deconRequired ?? false,
        hash: r.hash
      };
    });

  return json({ crops, herbicides });
};

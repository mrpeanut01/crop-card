/**
 * POST /api/plugins/[pluginId]/retire
 *
 * Tier-1 retire: soft-removes the plugin from the live registry by
 * moving its on-disk file to `plugins/_retired/<kind>s/` and setting
 * `retired_at` on the current `plugin_versions` row. Reversible via
 * `/unretire`. Pre-existing event rows that reference this plugin
 * keep rendering correctly because the historical version row is
 * still in the table.
 */

import { json, type RequestHandler } from '@sveltejs/kit';
import { requireOwner } from '$lib/server/auth';
import { PluginLifecycleError, retirePlugin } from '$lib/server/pluginLifecycle';

export const POST: RequestHandler = async (event) => {
  requireOwner(event);
  const pluginId = event.params.pluginId;
  if (!pluginId) return json({ error: 'pluginId is required' }, { status: 400 });
  try {
    await retirePlugin(pluginId);
    return json({ pluginId, retired: true });
  } catch (e) {
    if (e instanceof PluginLifecycleError) {
      const status = e.code === 'not-found' ? 404 : 500;
      return json({ error: e.message, code: e.code }, { status });
    }
    return json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
};

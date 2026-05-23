/**
 * POST /api/plugins/[pluginId]/unretire
 *
 * Reverses a Tier-1 retire: clears the `retired_at` timestamp on the
 * current version row + moves the on-disk file back from
 * `plugins/_retired/<kind>s/` to the live `plugins/<kind>s/` directory.
 */

import { json, type RequestHandler } from '@sveltejs/kit';
import { requireOwner } from '$lib/server/auth';
import { PluginLifecycleError, unretirePlugin } from '$lib/server/pluginLifecycle';

export const POST: RequestHandler = async (event) => {
  requireOwner(event);
  const pluginId = event.params.pluginId;
  if (!pluginId) return json({ error: 'pluginId is required' }, { status: 400 });
  try {
    await unretirePlugin(pluginId);
    return json({ pluginId, retired: false });
  } catch (e) {
    if (e instanceof PluginLifecycleError) {
      const status = e.code === 'not-found' ? 404 : 500;
      return json({ error: e.message, code: e.code }, { status });
    }
    return json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
};

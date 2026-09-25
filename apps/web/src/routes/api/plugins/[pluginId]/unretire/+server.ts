/**
 * POST /api/plugins/[pluginId]/unretire
 *
 * Default (owner): removes the active Owner's retire marker.
 * `?scope=global` (superadmin, interactive session): restores a globally
 * retired plugin in the shared library.
 */

import { json, type RequestHandler } from '@sveltejs/kit';
import { requireOwner, requireSuperadmin } from '$lib/server/auth';
import {
  PluginLifecycleError,
  unretirePlugin,
  unretirePluginForOwner
} from '$lib/server/pluginLifecycle';

export const POST: RequestHandler = async (event) => {
  const global = event.url.searchParams.get('scope') === 'global';
  if (global) requireSuperadmin(event);
  else requireOwner(event);
  const pluginId = event.params.pluginId;
  if (!pluginId) return json({ error: 'pluginId is required' }, { status: 400 });
  try {
    await (global ? unretirePlugin(pluginId) : unretirePluginForOwner(pluginId));
    return json({ pluginId, retired: false, scope: global ? 'global' : 'owner' });
  } catch (e) {
    if (e instanceof PluginLifecycleError) {
      const status = e.code === 'not-found' ? 404 : 500;
      return json({ error: e.message, code: e.code }, { status });
    }
    return json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
};

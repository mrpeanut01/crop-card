/**
 * POST /api/plugins/[pluginId]/retire
 *
 * Default (owner): hides the plugin for the active Owner only via a
 * `plugin_overrides` marker; other farms keep the shared plugin.
 * `?scope=global` (superadmin, interactive session): Tier-1 retire in the
 * shared library for every farm (file moved to `plugins/_retired/`, current
 * `plugin_versions` row gets `retired_at`). Both are reversible via
 * `/unretire` with the same scope, and historical events keep resolving by
 * hash.
 */

import { json, type RequestHandler } from '@sveltejs/kit';
import { requireOwner, requireSuperadmin } from '$lib/server/auth';
import {
  PluginLifecycleError,
  retirePlugin,
  retirePluginForOwner
} from '$lib/server/pluginLifecycle';

export const POST: RequestHandler = async (event) => {
  const global = event.url.searchParams.get('scope') === 'global';
  if (global) requireSuperadmin(event);
  else requireOwner(event);
  const pluginId = event.params.pluginId;
  if (!pluginId) return json({ error: 'pluginId is required' }, { status: 400 });
  try {
    await (global ? retirePlugin(pluginId) : retirePluginForOwner(pluginId));
    return json({ pluginId, retired: true, scope: global ? 'global' : 'owner' });
  } catch (e) {
    if (e instanceof PluginLifecycleError) {
      const status = e.code === 'not-found' ? 404 : 500;
      return json({ error: e.message, code: e.code }, { status });
    }
    return json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
};

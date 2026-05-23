/**
 * POST /api/plugins/[pluginId]/uninstall
 *
 * Body: { confirm: <pluginId> }
 *
 * Tier-2 hard delete. Refuses (409 + reference summary) if any event
 * row or active crop references the plugin. On accept: deletes the
 * payload-bearing `plugin_versions` rows, removes the on-disk file
 * from whichever location it lives in (live or _retired/), and writes
 * a tombstone row recording who uninstalled it.
 */

import { json, type RequestHandler } from '@sveltejs/kit';
import { requireOwner } from '$lib/server/auth';
import { PluginLifecycleError, uninstallPlugin } from '$lib/server/pluginLifecycle';

export const POST: RequestHandler = async (event) => {
  const session = requireOwner(event);
  const pluginId = event.params.pluginId;
  if (!pluginId) return json({ error: 'pluginId is required' }, { status: 400 });

  let body: unknown;
  try {
    body = await event.request.json();
  } catch {
    return json({ error: 'invalid JSON body' }, { status: 400 });
  }
  const confirm =
    body && typeof body === 'object' && 'confirm' in body
      ? String((body as { confirm: unknown }).confirm ?? '')
      : '';
  if (confirm !== pluginId) {
    return json(
      {
        error: 'Type the pluginId in the `confirm` field to authorize an irreversible uninstall.'
      },
      { status: 400 }
    );
  }

  try {
    const result = await uninstallPlugin(pluginId, { changedByUserId: session.id });
    return json(result);
  } catch (e) {
    if (e instanceof PluginLifecycleError) {
      const status = e.code === 'still-referenced' ? 409 : e.code === 'not-found' ? 404 : 500;
      return json({ error: e.message, code: e.code, references: e.references }, { status });
    }
    return json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
};

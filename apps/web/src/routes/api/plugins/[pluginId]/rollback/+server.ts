/**
 * POST /api/plugins/[pluginId]/rollback
 *
 * Body: { toVersion: string }
 *
 * Roll a plugin back to a historical version by writing a NEW forward
 * version row whose payload is a copy of the chosen historical row.
 * History is never edited; the rollback shows up as a regular row in the
 * timeline with `change_reason: 'rollback to X.Y.Z'`.
 *
 * Reuses the full upload validation pipeline so a rollback can't bypass
 * schema or safety checks even if a historical payload became invalid
 * after a kernel rule change.
 */

import { json, type RequestHandler } from '@sveltejs/kit';
import { requireOwner } from '$lib/server/auth';
import { PluginAuthorError, rollbackTo } from '$lib/server/pluginFiles';
import { historyOf } from '$lib/db/pluginVersions';

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
  const toVersion =
    body && typeof body === 'object' && 'toVersion' in body
      ? String((body as { toVersion: unknown }).toVersion ?? '')
      : '';
  if (!toVersion) {
    return json({ error: 'toVersion is required' }, { status: 400 });
  }

  const history = historyOf(pluginId);
  const target = history.find((r) => r.version === toVersion);
  if (!target) {
    return json({ error: `no version ${toVersion} on record for ${pluginId}` }, { status: 404 });
  }

  try {
    const result = await rollbackTo(target, { changedByUserId: session.id });
    return json(result, { status: 201 });
  } catch (e) {
    if (e instanceof PluginAuthorError) {
      return json({ error: e.message, code: e.code, issues: e.issues }, { status: 400 });
    }
    return json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
};

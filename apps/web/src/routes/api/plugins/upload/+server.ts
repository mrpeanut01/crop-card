/**
 * POST /api/plugins/upload
 *
 * Accepts a JSON plugin payload (raw body or { plugin: {...} }), validates
 * via Zod + the bypass check, writes it to plugins/{type}s/, and reloads
 * the registry. Returns the new file path and pluginId.
 */

import { json, type RequestHandler } from '@sveltejs/kit';
import { requireOwner } from '$lib/server/auth';
import { PluginAuthorError, writePluginFile } from '$lib/server/pluginFiles';

export const POST: RequestHandler = async (event) => {
  requireOwner(event);
  const { request } = event;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'invalid JSON body' }, { status: 400 });
  }
  const candidate =
    body && typeof body === 'object' && 'plugin' in body
      ? (body as { plugin: unknown }).plugin
      : body;
  try {
    const result = await writePluginFile(candidate);
    return json(result, { status: 201 });
  } catch (e) {
    if (e instanceof PluginAuthorError) {
      return json({ error: e.message, code: e.code, issues: e.issues }, { status: 400 });
    }
    return json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
};

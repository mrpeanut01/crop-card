/**
 * GET /api/plugins/:pluginId/export
 *
 * FR-17 — download a plugin's canonical JSON for sharing or backup.
 * Returns the same JSON the registry stores (after Zod normalization).
 * Anyone signed-in or anonymous can read; we don't gate it because
 * plugin definitions are inherently public farm-knowledge.
 */

import { json, type RequestHandler } from '@sveltejs/kit';
import { getRegistry } from '$lib/server/registry';

export const GET: RequestHandler = async ({ params }) => {
  if (!params.pluginId) return json({ error: 'pluginId required' }, { status: 400 });
  const registry = await getRegistry();
  const record = registry.get(params.pluginId);
  if (!record) return json({ error: 'not found' }, { status: 404 });

  const body = JSON.stringify(record.plugin, null, 2);
  return new Response(body, {
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition': `attachment; filename="${record.plugin.pluginId}.json"`,
      'X-Plugin-Hash': record.hash
    }
  });
};

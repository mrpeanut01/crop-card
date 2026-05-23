import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireApp } from '$lib/server/auth';
import { getByHash } from '$lib/server/plugins';

export const GET: RequestHandler = async (event) => {
  requireApp(event);
  const row = getByHash(event.params.pluginId, event.params.hash);
  if (!row) throw error(404, 'no approved version with that hash');
  // Content-addressed → immutable forever.
  return json(row, {
    headers: { 'cache-control': 'public, immutable, max-age=31536000' }
  });
};

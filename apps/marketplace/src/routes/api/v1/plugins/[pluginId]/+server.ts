import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireApp } from '$lib/server/auth';
import { getLatestApproved } from '$lib/server/plugins';

export const GET: RequestHandler = async (event) => {
  requireApp(event);
  const row = getLatestApproved(event.params.pluginId);
  if (!row) throw error(404, 'plugin not found or has no approved version');
  return json(row);
};

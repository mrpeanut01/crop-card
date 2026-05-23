import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireApp } from '$lib/server/auth';
import { listApprovedVersions } from '$lib/server/plugins';

export const GET: RequestHandler = async (event) => {
  requireApp(event);
  const versions = listApprovedVersions(event.params.pluginId);
  return json({ versions });
};

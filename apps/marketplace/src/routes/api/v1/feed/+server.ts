import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireApp } from '$lib/server/auth';
import { feedSince } from '$lib/server/plugins';

export const GET: RequestHandler = async (event) => {
  requireApp(event);
  const since = event.url.searchParams.get('since') ?? undefined;
  const limitStr = event.url.searchParams.get('limit');
  let limit: number | undefined;
  if (limitStr) {
    const n = Number(limitStr);
    if (Number.isFinite(n) && n >= 1) limit = Math.min(n, 500);
  }
  const result = feedSince({ since, limit });
  return json(result);
};

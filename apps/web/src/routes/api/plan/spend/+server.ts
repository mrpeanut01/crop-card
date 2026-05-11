import { json, type RequestHandler } from '@sveltejs/kit';
import { requireOwner } from '$lib/server/auth';
import { spendSnapshot } from '$lib/server/aiGuard';

export const GET: RequestHandler = (event) => {
  requireOwner(event);
  return json(spendSnapshot());
};

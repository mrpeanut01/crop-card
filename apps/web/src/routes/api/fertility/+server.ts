/**
 * GET /api/fertility?blockId=...&year=...
 * POST /api/fertility/applications | /api/fertility/credits | /api/fertility/soil-tests
 *
 * The mutation surface routes live under sibling +server.ts files; this
 * top-level handler returns the per-block budget summary.
 */

import { json, type RequestHandler } from '@sveltejs/kit';
import { fertilityBudgetForBlock } from '$lib/db/fertility';

export const GET: RequestHandler = ({ url }) => {
  const blockId = url.searchParams.get('blockId');
  const year = Number(url.searchParams.get('year')) || new Date().getFullYear();
  if (!blockId) return json({ error: 'blockId required' }, { status: 400 });
  const budget = fertilityBudgetForBlock(blockId, year);
  return json({ budget });
};

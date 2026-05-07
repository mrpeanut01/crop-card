/**
 * GET /api/spray/records — list spray records with optional filters and
 * the lock state surfaced (FR-09 48-hour immutability).
 *
 * Query params:
 *   blockId?, sprayerId?, fromMs?, toMs?, limit?
 */

import { json, type RequestHandler } from '@sveltejs/kit';
import { evaluateLock, listSprayEvents } from '$lib/db/sprayEvents';

function intParam(value: string | null): number | undefined {
  if (!value) return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

export const GET: RequestHandler = ({ url }) => {
  const events = listSprayEvents({
    blockId: url.searchParams.get('blockId') ?? undefined,
    sprayerId: url.searchParams.get('sprayerId') ?? undefined,
    fromMs: intParam(url.searchParams.get('fromMs')),
    toMs: intParam(url.searchParams.get('toMs')),
    limit: intParam(url.searchParams.get('limit')) ?? 200
  });

  const records = events.map((e) => ({
    ...e,
    locked: evaluateLock(e) !== undefined
  }));

  return json({ records });
};

/**
 * GET  /api/blocks/:id/protections  (any member) the block's covers and its
 *      effective frost for the planning year
 * POST /api/blocks/:id/protections  (owner) add a cover
 *
 * Covers are planning data, not records: no lock, and a closed season never
 * blocks them (E0-6).
 */

import { error, json, type RequestHandler } from '@sveltejs/kit';
import { getBlock } from '$lib/db/blocks';
import { insertBlockProtection, listBlockProtections } from '$lib/db/blockProtections';
import { blockProtectionCreateSchema } from '$lib/farm/apiSchemas';
import { resolveNewProtection } from '$lib/climate/protection';
import { currentUser, requireOwner, requireUser } from '$lib/server/auth';
import {
  bedFrostView,
  effectiveFrostContext,
  loadEffectiveFrostByBlock
} from '$lib/server/blockFrost.server';
import type { BlockCoversResponse } from '$lib/climate/protectionView';
import { getActivePlanningYear } from '$lib/season/planningYear.server';

export const _requestSchema = blockProtectionCreateSchema;

function view(blockId: string, year: number, locale?: string | null): BlockCoversResponse {
  const ctx = effectiveFrostContext(year);
  const eff = loadEffectiveFrostByBlock([blockId], year, ctx)[blockId];
  return {
    protections: listBlockProtections([blockId]),
    seasonYear: year,
    effectiveFrost: eff,
    frost: bedFrostView(eff, ctx.farm, year, locale)
  };
}

function yearParam(url: URL): number {
  const raw = Number(url.searchParams.get('year'));
  return Number.isInteger(raw) && raw >= 2000 && raw <= 2100 ? raw : getActivePlanningYear();
}

export const GET: RequestHandler = (event) => {
  requireUser(event);
  const block = getBlock(event.params.id!);
  if (!block) throw error(404, 'block not found');
  return json(view(block.id, yearParam(event.url), event.locals?.locale));
};

export const POST: RequestHandler = async (event) => {
  const user = currentUser(event);
  if (user && user.role !== 'owner' && user.role !== 'inspector') {
    return json({ error: 'Only the owner can add covers. Ask the owner.' }, { status: 403 });
  }
  requireOwner(event);
  const block = getBlock(event.params.id!);
  if (!block) throw error(404, 'block not found');
  let body: unknown;
  try {
    body = await event.request.json();
  } catch {
    return json({ error: 'invalid JSON body' }, { status: 400 });
  }
  const parsed = blockProtectionCreateSchema.safeParse(body);
  if (!parsed.success) {
    return json({ error: 'invalid request', issues: parsed.error.issues }, { status: 400 });
  }
  const d = parsed.data;
  const shifts = resolveNewProtection(d.kind, {
    springShiftDays: d.springShiftDays,
    fallShiftDays: d.fallShiftDays
  });
  const protection = insertBlockProtection({
    blockId: block.id,
    kind: d.kind,
    ...shifts,
    installedOn: d.installedOn ?? null,
    removedOn: d.removedOn ?? null,
    seasonYear: d.seasonYear ?? null,
    notes: d.notes?.trim() || null
  });
  return json(
    { protection, ...view(block.id, yearParam(event.url), event.locals?.locale) },
    { status: 201 }
  );
};

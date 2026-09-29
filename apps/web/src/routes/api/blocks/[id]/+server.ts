/**
 * GET    /api/blocks/:id  — fetch one block with its plantings
 * PATCH  /api/blocks/:id  — edit name/acres/blockLabel/fieldId (Phase 13)
 * DELETE /api/blocks/:id  — heavy cascade through all crops + events;
 *        ?ifEmpty=1 (garden designer) refuses with 409 BED_HAS_RECORDS
 *        unless the block holds only planned plantings
 */

import { error, json, type RequestHandler } from '@sveltejs/kit';
import { blockHasRecords, deleteBlockCascade } from '$lib/db/admin';
import { getBlock, updateBlock } from '$lib/db/blocks';
import { getField } from '$lib/db/fields';
import { withSketchAcres } from '$lib/farm/sketch';
import { blockPatchSchema } from '$lib/farm/apiSchemas';
import { DEFAULT_BLOCK_KIND, usesDesignerLayout } from '$lib/farm/areaKinds';
import { blockPlacementError } from '$lib/farm/blockLayout';
import {
  bedLayoutProblem,
  clampFinishedFootprints,
  plantingsPastBedEdge
} from '$lib/server/garden/bedLayout';
import { requireOwner } from '$lib/server/auth';
import { blockReassignRefusal, blocksDeleteRefusal } from '$lib/server/areaGrazing';
import { farmTimeZone } from '$lib/db/userProfile';
import { tryGuardedHoldWrite } from '$lib/server/holdGuard';

export const GET: RequestHandler = (event) => {
  if (!event.params.id) throw error(400, 'id required');
  const block = getBlock(event.params.id);
  if (!block) throw error(404, 'block not found');
  return json({ block });
};

export const _requestSchema = blockPatchSchema;

export const PATCH: RequestHandler = async (event) => {
  if (!event.params.id) throw error(400, 'id required');
  const user = requireOwner(event);
  const block = getBlock(event.params.id);
  if (!block) throw error(404, 'block not found');

  let body: unknown;
  try {
    body = await event.request.json();
  } catch {
    return json({ error: 'invalid JSON body' }, { status: 400 });
  }
  const parsed = blockPatchSchema.safeParse(body);
  if (!parsed.success) {
    return json({ error: 'invalid request', issues: parsed.error.issues }, { status: 400 });
  }
  const newArea = parsed.data.fieldId ? getField(parsed.data.fieldId) : undefined;
  if (parsed.data.fieldId && !newArea) {
    return json({ error: 'unknown fieldId' }, { status: 400 });
  }
  if (newArea && newArea.id !== block.fieldId) {
    const refusal = await blockReassignRefusal(block.id, farmTimeZone());
    if (refusal) return json(refusal, { status: 409 });
  }
  const kind = parsed.data.kind ?? block.kind ?? DEFAULT_BLOCK_KIND;
  const placementChanged = parsed.data.kind !== undefined || parsed.data.fieldId !== undefined;
  const area = newArea ?? (block.fieldId ? getField(block.fieldId) : undefined);
  const placement = blockPlacementError(
    placementChanged ? (area?.kind ?? null) : null,
    kind,
    parsed.data
  );
  if (placement) return json({ error: placement }, { status: 400 });
  const patch = usesDesignerLayout(kind)
    ? parsed.data
    : { ...parsed.data, xFt: null, yFt: null, rotationDeg: null, bedStyle: null };
  const pick = <T>(next: T | null | undefined, prev: T | undefined): T | undefined =>
    next === undefined ? prev : (next ?? undefined);
  const layoutProblem = bedLayoutProblem({
    id: block.id,
    name: parsed.data.name ?? block.name,
    kind,
    fieldId: parsed.data.fieldId ?? block.fieldId,
    widthFt: pick(parsed.data.widthFt, block.widthFt),
    lengthFt: pick(parsed.data.lengthFt, block.lengthFt),
    xFt: pick(patch.xFt, block.xFt),
    yFt: pick(patch.yFt, block.yFt),
    rotationDeg: pick(patch.rotationDeg, block.rotationDeg)
  });
  if (layoutProblem) return json(layoutProblem, { status: 409 });
  const resized =
    usesDesignerLayout(kind) &&
    (parsed.data.widthFt !== undefined || parsed.data.lengthFt !== undefined);
  const nextSize = {
    widthFt: pick(parsed.data.widthFt, block.widthFt),
    lengthFt: pick(parsed.data.lengthFt, block.lengthFt)
  };
  if (resized) {
    const shrink = plantingsPastBedEdge(block.id, block.name, nextSize);
    if (shrink) return json(shrink, { status: 409 });
  }
  const guarded = await tryGuardedHoldWrite(event, user, () => {
    const saved = updateBlock(event.params.id!, withSketchAcres(patch));
    if (resized) clampFinishedFootprints(block.id, nextSize);
    return saved;
  });
  if (!guarded.ok) return guarded.response;
  return json({ block: guarded.value });
};

export const DELETE: RequestHandler = async (event) => {
  if (!event.params.id) throw error(400, 'id required');
  const user = requireOwner(event);
  const block = getBlock(event.params.id);
  if (!block) throw error(404, 'block not found');
  const held = await blocksDeleteRefusal(block.fieldId ?? null, [block.id], farmTimeZone());
  if (held) return json(held, { status: 409 });
  if (event.url.searchParams.get('ifEmpty') === '1') {
    if (blockHasRecords(block.id)) {
      return json(
        {
          error: `${block.name} has records, so it stays. Delete it from the Plan page if you really mean it.`,
          code: 'BED_HAS_RECORDS'
        },
        { status: 409 }
      );
    }
  }
  const id = event.params.id;
  const guarded = await tryGuardedHoldWrite(event, user, () => deleteBlockCascade(id));
  if (!guarded.ok) return guarded.response;
  return json(guarded.value);
};

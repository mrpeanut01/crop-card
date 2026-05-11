/**
 * PATCH  /api/shade-sources/[id]  — owner-only; update a shade source
 * DELETE /api/shade-sources/[id]  — owner-only; remove a shade source
 */

import { json, type RequestHandler } from '@sveltejs/kit';
import { z } from 'zod';
import { deleteShadeSource, getShadeSource, updateShadeSource } from '$lib/db/shadeSources';
import { requireOwner } from '$lib/server/auth';

const KINDS = [
  'tree-row',
  'tree-grove',
  'tree-single',
  'hedge',
  'building',
  'fence',
  'structure',
  'other'
] as const;

const updateSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  kind: z.enum(KINDS).optional(),
  geometryGeojson: z.string().nullable().optional(),
  fieldId: z.string().nullable().optional(),
  heightFt: z.number().positive().max(200).optional(),
  opacity: z.number().min(0).max(1).optional(),
  isDeciduous: z.boolean().optional(),
  leafOnDayOfYear: z.number().int().min(1).max(366).optional(),
  leafOffDayOfYear: z.number().int().min(1).max(366).optional(),
  notes: z.string().max(500).nullable().optional()
});

export const PATCH: RequestHandler = async (event) => {
  requireOwner(event);
  const id = event.params.id;
  if (!id) return json({ error: 'missing id' }, { status: 400 });
  if (!getShadeSource(id)) return json({ error: 'not found' }, { status: 404 });
  let body: unknown;
  try {
    body = await event.request.json();
  } catch {
    return json({ error: 'invalid JSON body' }, { status: 400 });
  }
  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) {
    return json({ error: 'invalid request', issues: parsed.error.issues }, { status: 400 });
  }
  const updated = updateShadeSource(id, parsed.data);
  return json({ shadeSource: updated });
};

export const DELETE: RequestHandler = (event) => {
  requireOwner(event);
  const id = event.params.id;
  if (!id) return json({ error: 'missing id' }, { status: 400 });
  const ok = deleteShadeSource(id);
  if (!ok) return json({ error: 'not found' }, { status: 404 });
  return json({ ok: true });
};

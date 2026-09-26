/**
 * GET    /api/fields/:id  — fetch one field
 * PATCH  /api/fields/:id  — edit name/acres/location/notes/geometry/kind/details
 * DELETE /api/fields/:id  — cascade through every block + crop + event
 */

import { error, json, type RequestHandler } from '@sveltejs/kit';
import { z } from 'zod';
import { deleteFieldCascade } from '$lib/db/admin';
import { getField, updateField } from '$lib/db/fields';
import { MAX_SKETCH_FT, withSketchAcres } from '$lib/farm/sketch';
import { AREA_KINDS, isDesignable, validateAreaDetails } from '$lib/farm/areaKinds';
import { bedsPastAreaEdge } from '$lib/server/garden/bedLayout';
import { requireOwner } from '$lib/server/auth';

export const GET: RequestHandler = ({ params }) => {
  if (!params.id) throw error(400, 'id required');
  const field = getField(params.id);
  if (!field) throw error(404, 'field not found');
  return json({ field });
};

const patchSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  acres: z.number().positive().nullable().optional(),
  location: z.string().max(500).nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
  geometryGeojson: z.string().nullable().optional(),
  widthFt: z.number().positive().max(MAX_SKETCH_FT).nullable().optional(),
  lengthFt: z.number().positive().max(MAX_SKETCH_FT).nullable().optional(),
  kind: z.enum(AREA_KINDS).optional(),
  details: z.unknown().optional()
});

export const PATCH: RequestHandler = async (event) => {
  if (!event.params.id) throw error(400, 'id required');
  requireOwner(event);
  const existing = getField(event.params.id);
  if (!existing) throw error(404, 'field not found');

  let body: unknown;
  try {
    body = await event.request.json();
  } catch {
    return json({ error: 'invalid JSON body' }, { status: 400 });
  }
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return json({ error: 'invalid request', issues: parsed.error.issues }, { status: 400 });
  }
  const nextKind = parsed.data.kind ?? existing.kind;
  const reshapes =
    parsed.data.widthFt !== undefined ||
    parsed.data.lengthFt !== undefined ||
    parsed.data.geometryGeojson !== undefined ||
    (parsed.data.kind !== undefined && parsed.data.kind !== existing.kind);
  if (reshapes && (isDesignable(existing.kind) || isDesignable(nextKind))) {
    const pick = <T>(next: T | null | undefined, prev: T | null | undefined): T | null =>
      next === undefined ? (prev ?? null) : next;
    const problem = bedsPastAreaEdge({
      id: existing.id,
      name: parsed.data.name ?? existing.name,
      kind: nextKind,
      widthFt: pick(parsed.data.widthFt, existing.widthFt),
      lengthFt: pick(parsed.data.lengthFt, existing.lengthFt),
      geometryGeojson: pick(parsed.data.geometryGeojson, existing.geometryGeojson)
    });
    if (problem) return json(problem, { status: 409 });
  }
  const { details: rawDetails, ...rest } = parsed.data;
  let details;
  if (rawDetails !== undefined) {
    const checked = validateAreaDetails(rest.kind ?? existing.kind, rawDetails);
    if (!checked.ok) {
      return json({ error: 'invalid details for kind', issues: checked.issues }, { status: 400 });
    }
    details = checked.details;
  }
  const field = updateField(event.params.id, { ...withSketchAcres(rest), details });
  return json({ field });
};

export const DELETE: RequestHandler = (event) => {
  if (!event.params.id) throw error(400, 'id required');
  requireOwner(event);
  if (!getField(event.params.id)) throw error(404, 'field not found');
  return json(deleteFieldCascade(event.params.id));
};

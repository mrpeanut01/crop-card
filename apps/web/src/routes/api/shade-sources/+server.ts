/**
 * GET  /api/shade-sources       — list all external shade sources
 * POST /api/shade-sources       — owner-only; create a new shade source
 */

import { json, type RequestHandler } from '@sveltejs/kit';
import { z } from 'zod';
import { createShadeSource, listShadeSources } from '$lib/db/shadeSources';
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

export const GET: RequestHandler = () => {
  return json({ shadeSources: listShadeSources() });
};

const createSchema = z.object({
  name: z.string().min(1).max(120),
  kind: z.enum(KINDS).optional(),
  geometryGeojson: z.string().optional(),
  fieldId: z.string().optional(),
  heightFt: z.number().positive().max(200),
  opacity: z.number().min(0).max(1).optional(),
  isDeciduous: z.boolean().optional(),
  leafOnDayOfYear: z.number().int().min(1).max(366).optional(),
  leafOffDayOfYear: z.number().int().min(1).max(366).optional(),
  notes: z.string().max(500).optional()
});

export const POST: RequestHandler = async (event) => {
  requireOwner(event);
  let body: unknown;
  try {
    body = await event.request.json();
  } catch {
    return json({ error: 'invalid JSON body' }, { status: 400 });
  }
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return json({ error: 'invalid request', issues: parsed.error.issues }, { status: 400 });
  }
  return json({ shadeSource: createShadeSource(parsed.data) }, { status: 201 });
};

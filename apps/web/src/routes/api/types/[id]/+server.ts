/**
 * PATCH  /api/types/:id — rename or re-describe a term (owner-only).
 * DELETE /api/types/:id — delete a user-added term (default terms cannot be deleted).
 */

import { json, type RequestHandler } from '@sveltejs/kit';
import { z } from 'zod';
import {
  DefaultTermDeleteError,
  DuplicateTaxonomyTermError,
  deleteTaxonomyTerm,
  getTaxonomyTerm,
  updateTaxonomyTerm
} from '$lib/db/taxonomy';
import { requireOwner } from '$lib/server/auth';

const patchSchema = z.object({
  name: z.string().min(1).max(80).optional(),
  description: z.string().max(500).nullable().optional()
});

export const PATCH: RequestHandler = async (event) => {
  requireOwner(event);
  if (!event.params.id || !getTaxonomyTerm(event.params.id)) {
    return json({ error: 'unknown taxonomy term' }, { status: 404 });
  }
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
  try {
    const term = updateTaxonomyTerm(event.params.id, parsed.data);
    return json({ type: term });
  } catch (e) {
    if (e instanceof DuplicateTaxonomyTermError) {
      return json({ error: e.message }, { status: 409 });
    }
    return json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
};

export const DELETE: RequestHandler = (event) => {
  requireOwner(event);
  if (!event.params.id) return json({ error: 'unknown taxonomy term' }, { status: 404 });
  try {
    deleteTaxonomyTerm(event.params.id);
    return json({ ok: true });
  } catch (e) {
    if (e instanceof DefaultTermDeleteError) {
      return json({ error: e.message }, { status: 400 });
    }
    return json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
};

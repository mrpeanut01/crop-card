/**
 * GET  /api/types?domain=...  — list taxonomy terms (optionally filtered).
 * POST /api/types             — owner-only; add a new user-defined term.
 *
 * Domain examples: 'inventory:seed', 'inventory:herbicide', 'equipment'.
 */

import { json, type RequestHandler } from '@sveltejs/kit';
import { z } from 'zod';
import {
  createTaxonomyTerm,
  DuplicateTaxonomyTermError,
  listTaxonomyTerms
} from '$lib/db/taxonomy';
import { requireOwner } from '$lib/server/auth';

export const GET: RequestHandler = ({ url }) => {
  const domain = url.searchParams.get('domain') ?? undefined;
  return json({ types: listTaxonomyTerms(domain ? { domain } : undefined) });
};

const createSchema = z.object({
  domain: z
    .string()
    .min(1)
    .max(80)
    .regex(/^[a-z0-9:_-]+$/i, 'domain must be slug-like'),
  name: z.string().min(1).max(80),
  description: z.string().max(500).optional()
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
  try {
    const term = createTaxonomyTerm(parsed.data);
    return json({ type: term }, { status: 201 });
  } catch (e) {
    if (e instanceof DuplicateTaxonomyTermError) {
      return json({ error: e.message }, { status: 409 });
    }
    return json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
};

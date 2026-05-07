import { json, type RequestHandler } from '@sveltejs/kit';
import { z } from 'zod';
import { createBlock, listBlocks } from '$lib/db/blocks';
import { requireOwner } from '$lib/server/auth';

export const GET: RequestHandler = () => {
  return json({ blocks: listBlocks() });
};

const createSchema = z.object({
  name: z.string().min(1).max(120),
  acres: z.number().positive().optional(),
  blockLabel: z.string().max(60).optional()
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
  const block = createBlock(parsed.data);
  return json({ block }, { status: 201 });
};

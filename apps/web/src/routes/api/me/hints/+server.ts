/**
 * GET  /api/me/hints — first-use hints the signed-in user has dismissed
 * POST /api/me/hints — mark hints seen: `{ key }` or `{ keys: [...] }`
 *                      (the batch form lets the client flush offline dismissals)
 */

import { json, type RequestHandler } from '@sveltejs/kit';
import { z } from 'zod';
import { listSeen, markSeen } from '$lib/db/userHints';
import { hintKeySchema } from '$lib/hints';
import { requireUser } from '$lib/server/auth';

export const GET: RequestHandler = (event) => {
  const user = requireUser(event);
  return json({ hints: listSeen(user.id) });
};

const postSchema = z.union([
  z.object({ key: hintKeySchema }),
  z.object({ keys: z.array(hintKeySchema).min(1).max(50) })
]);

export const POST: RequestHandler = async (event) => {
  const user = requireUser(event);
  let body: unknown;
  try {
    body = await event.request.json();
  } catch {
    return json({ error: 'invalid JSON body' }, { status: 400 });
  }
  const parsed = postSchema.safeParse(body);
  if (!parsed.success) {
    return json({ error: 'invalid request', issues: parsed.error.issues }, { status: 400 });
  }
  const keys = 'key' in parsed.data ? [parsed.data.key] : [...new Set(parsed.data.keys)];
  for (const key of keys) {
    if (!markSeen(user.id, key)) {
      return json({ error: 'too many hints recorded' }, { status: 409 });
    }
  }
  return json({ hints: listSeen(user.id) });
};

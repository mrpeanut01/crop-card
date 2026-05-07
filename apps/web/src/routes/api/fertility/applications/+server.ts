import { json, type RequestHandler } from '@sveltejs/kit';
import { z } from 'zod';
import { insertFertilityApplication, listFertilityApplicationsForBlock } from '$lib/db/fertility';
import { ensureSystemUser } from '$lib/db/users';
import { currentUser } from '$lib/server/auth';

const inputSchema = z.object({
  blockId: z.string().min(1),
  occurredAt: z.number().int().optional(),
  source: z.string().min(1).max(120),
  stockItemId: z.string().optional(),
  ratePerAcre: z.number().nonnegative(),
  rateUnit: z.string().min(1).max(40),
  nLbPerAcre: z.number().nonnegative().optional(),
  pLbPerAcre: z.number().nonnegative().optional(),
  kLbPerAcre: z.number().nonnegative().optional(),
  notes: z.string().max(500).optional()
});

export const POST: RequestHandler = async (event) => {
  const auth = currentUser(event);
  let body: unknown;
  try {
    body = await event.request.json();
  } catch {
    return json({ error: 'invalid JSON' }, { status: 400 });
  }
  const parsed = inputSchema.safeParse(body);
  if (!parsed.success) {
    return json(
      {
        error: 'invalid request',
        issues: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message }))
      },
      { status: 400 }
    );
  }
  const performer = auth ?? (await ensureSystemUser());
  const persisted = insertFertilityApplication({
    ...parsed.data,
    occurredAt: parsed.data.occurredAt ?? Date.now(),
    performedById: performer.id
  });
  return json({ application: persisted }, { status: 201 });
};

export const GET: RequestHandler = ({ url }) => {
  const blockId = url.searchParams.get('blockId');
  if (!blockId) return json({ error: 'blockId required' }, { status: 400 });
  return json({ applications: listFertilityApplicationsForBlock(blockId) });
};

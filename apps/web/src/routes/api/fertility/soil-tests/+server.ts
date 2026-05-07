import { json, type RequestHandler } from '@sveltejs/kit';
import { z } from 'zod';
import { insertSoilTest, listSoilTestsForBlock } from '$lib/db/fertility';

const inputSchema = z.object({
  blockId: z.string().min(1),
  sampledAt: z.number().int().optional(),
  lab: z.string().max(120).optional(),
  reportPdfUrl: z.string().url().optional(),
  ph: z.number().min(0).max(14).optional(),
  cec: z.number().nonnegative().optional(),
  organicMatterPct: z.number().min(0).max(100).optional(),
  nitratePpm: z.number().nonnegative().optional(),
  phosphorusPpm: z.number().nonnegative().optional(),
  potassiumPpm: z.number().nonnegative().optional(),
  notes: z.string().max(500).optional()
});

export const POST: RequestHandler = async (event) => {
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
  const persisted = insertSoilTest({
    ...parsed.data,
    sampledAt: parsed.data.sampledAt ?? Date.now()
  });
  return json({ soilTest: persisted }, { status: 201 });
};

export const GET: RequestHandler = ({ url }) => {
  const blockId = url.searchParams.get('blockId');
  if (!blockId) return json({ error: 'blockId required' }, { status: 400 });
  return json({ soilTests: listSoilTestsForBlock(blockId) });
};

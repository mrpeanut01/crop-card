import { json, type RequestHandler } from '@sveltejs/kit';
import { getBlock } from '$lib/db/blocks';
import { insertSoilTest, listSoilTestsForBlock } from '$lib/db/fertility';
import { requireOwner } from '$lib/server/auth';
import { rejectForeignRefs } from '$lib/server/foreignRefs';
import { soilTestCreateSchema } from '$lib/fertility/apiSchemas';

export const _requestSchema = soilTestCreateSchema;

export const POST: RequestHandler = async (event) => {
  requireOwner(event);
  let body: unknown;
  try {
    body = await event.request.json();
  } catch {
    return json({ error: 'invalid JSON' }, { status: 400 });
  }
  const parsed = soilTestCreateSchema.safeParse(body);
  if (!parsed.success) {
    return json(
      {
        error: 'invalid request',
        issues: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message }))
      },
      { status: 400 }
    );
  }
  const foreign = rejectForeignRefs(['blockId', parsed.data.blockId, getBlock]);
  if (foreign) return foreign;
  const persisted = insertSoilTest({
    ...parsed.data,
    sampledAt: parsed.data.sampledAt ?? Date.now(),
    provenance: 'manual'
  });
  return json({ soilTest: persisted }, { status: 201 });
};

export const GET: RequestHandler = ({ url }) => {
  const blockId = url.searchParams.get('blockId');
  if (!blockId) return json({ error: 'blockId required' }, { status: 400 });
  return json({ soilTests: listSoilTestsForBlock(blockId) });
};

import { json, type RequestHandler } from '@sveltejs/kit';
import { z } from 'zod';
import {
  insertFertilityCredit,
  listFertilityCreditsForBlock
} from '$lib/db/fertility';
import { defaultCoverCredit } from '$lib/fertility/coverCropCredits';

const inputSchema = z.object({
  blockId: z.string().min(1),
  appliesToYear: z.number().int().min(1900).max(3000),
  source: z.string().min(1).max(120),
  cropPluginId: z.string().optional(),
  nLbPerAcre: z.number().nonnegative().optional(),
  pLbPerAcre: z.number().nonnegative().optional(),
  kLbPerAcre: z.number().nonnegative().optional(),
  /** When true, look up defaults from the cover-crop credit table. */
  useDefaults: z.boolean().optional(),
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

  let { nLbPerAcre, pLbPerAcre, kLbPerAcre, notes } = parsed.data;
  if (parsed.data.useDefaults && parsed.data.cropPluginId) {
    const def = defaultCoverCredit(parsed.data.cropPluginId);
    if (def) {
      nLbPerAcre ??= def.nLbPerAcre;
      pLbPerAcre ??= def.pLbPerAcre;
      kLbPerAcre ??= def.kLbPerAcre;
      notes ??= def.rationale;
    }
  }

  const persisted = insertFertilityCredit({
    blockId: parsed.data.blockId,
    appliesToYear: parsed.data.appliesToYear,
    source: parsed.data.source,
    cropPluginId: parsed.data.cropPluginId,
    nLbPerAcre,
    pLbPerAcre,
    kLbPerAcre,
    notes
  });
  return json({ credit: persisted }, { status: 201 });
};

export const GET: RequestHandler = ({ url }) => {
  const blockId = url.searchParams.get('blockId');
  if (!blockId) return json({ error: 'blockId required' }, { status: 400 });
  const year = Number(url.searchParams.get('year')) || undefined;
  return json({ credits: listFertilityCreditsForBlock(blockId, year) });
};

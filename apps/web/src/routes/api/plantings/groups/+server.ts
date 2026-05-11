import { json, type RequestHandler } from '@sveltejs/kit';
import { z } from 'zod';
import { getBlock } from '$lib/db/blocks';
import { createPlantingGroup, type CreateGroupInput } from '$lib/db/crops';
import { requireOwner } from '$lib/server/auth';
import { getRegistry } from '$lib/server/registry';
import type { CropPlugin } from '$lib/plugins/schemas';

const memberSchema = z.object({
  cropPluginId: z.string().min(1),
  varietyDisplayName: z.string().min(1).max(160),
  offsetDays: z.number().int().nonnegative().max(365).optional(),
  quantityPlanted: z.number().nonnegative().optional(),
  quantityUnit: z.string().min(1).max(16).optional(),
  /** Phase 15d — when present, promote this existing draft crop into the
   *  group instead of inserting a new row. The wizard always passes this
   *  for proposals built off existing drafts. */
  existingCropId: z.string().min(1).optional()
});

const groupSchema = z.object({
  blockId: z.string().min(1),
  anchorPlantingDateMs: z.number().int(),
  systemKind: z.enum(['three-sisters', 'succession', 'manual']),
  anchor: memberSchema,
  /** A group must have at least one companion — a singleton "group" is just
   *  a regular planting and should go through POST /api/blocks/[id]/plantings. */
  companions: z.array(memberSchema).min(1).max(8)
});

export const POST: RequestHandler = async (event) => {
  requireOwner(event);

  let body: unknown;
  try {
    body = await event.request.json();
  } catch {
    return json({ error: 'invalid JSON body' }, { status: 400 });
  }
  const parsed = groupSchema.safeParse(body);
  if (!parsed.success) {
    return json({ error: 'invalid request', issues: parsed.error.issues }, { status: 400 });
  }

  if (!getBlock(parsed.data.blockId)) {
    return json({ error: 'unknown block' }, { status: 404 });
  }

  const registry = await getRegistry();
  const resolvePlugin = (id: string): CropPlugin | undefined => {
    const rec = registry.get(id);
    if (!rec || rec.plugin.type !== 'crop') return undefined;
    return rec.plugin as CropPlugin;
  };

  const input: CreateGroupInput = {
    blockId: parsed.data.blockId,
    anchorPlantingDateMs: parsed.data.anchorPlantingDateMs,
    systemKind: parsed.data.systemKind,
    anchor: parsed.data.anchor,
    companions: parsed.data.companions,
    resolvePlugin
  };

  try {
    const result = createPlantingGroup(input);
    return json({ group: result }, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'commit failed';
    return json({ error: message }, { status: 400 });
  }
};

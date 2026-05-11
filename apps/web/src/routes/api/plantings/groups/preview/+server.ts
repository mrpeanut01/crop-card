import { json, type RequestHandler } from '@sveltejs/kit';
import { z } from 'zod';
import { getBlock } from '$lib/db/blocks';
import { previewPlantingGroup, type CreateGroupInput } from '$lib/db/crops';
import { requireOwner } from '$lib/server/auth';
import { getRegistry } from '$lib/server/registry';
import type { CropPlugin } from '$lib/plugins/schemas';

const memberSchema = z.object({
  cropPluginId: z.string().min(1),
  varietyDisplayName: z.string().min(1).max(160),
  offsetDays: z.number().int().nonnegative().max(365).optional(),
  quantityPlanted: z.number().nonnegative().optional(),
  quantityUnit: z.string().min(1).max(16).optional(),
  existingCropId: z.string().min(1).optional()
});

const groupSchema = z.object({
  blockId: z.string().min(1),
  anchorPlantingDateMs: z.number().int(),
  systemKind: z.enum(['three-sisters', 'succession', 'manual']),
  anchor: memberSchema,
  /** Preview also requires ≥1 companion — see the commit endpoint for rationale. */
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
    const preview = previewPlantingGroup(input);
    return json({ preview });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'preview failed';
    return json({ error: message }, { status: 400 });
  }
};

import { json, type RequestHandler } from '@sveltejs/kit';
import { z } from 'zod';
import { addPlanting, getBlock } from '$lib/db/blocks';
import { requireOwner } from '$lib/server/auth';
import { getRegistry } from '$lib/server/registry';

const plantingSchema = z.object({
  cropPluginId: z.string().min(1),
  varietyDisplayName: z.string().min(1).max(160).optional(),
  plantingDate: z.number().int()
});

export const POST: RequestHandler = async (event) => {
  requireOwner(event);

  const blockId = event.params.id;
  if (!blockId || !getBlock(blockId)) {
    return json({ error: 'unknown block' }, { status: 404 });
  }

  let body: unknown;
  try {
    body = await event.request.json();
  } catch {
    return json({ error: 'invalid JSON body' }, { status: 400 });
  }
  const parsed = plantingSchema.safeParse(body);
  if (!parsed.success) {
    return json({ error: 'invalid request', issues: parsed.error.issues }, { status: 400 });
  }

  const registry = await getRegistry();
  const plugin = registry.get(parsed.data.cropPluginId);
  if (!plugin || plugin.plugin.type !== 'crop') {
    return json({ error: 'unknown crop plugin' }, { status: 404 });
  }

  const planting = addPlanting({
    blockId,
    cropPluginId: parsed.data.cropPluginId,
    varietyDisplayName: parsed.data.varietyDisplayName ?? plugin.plugin.displayName,
    plantingDate: parsed.data.plantingDate
  });

  return json({ planting }, { status: 201 });
};

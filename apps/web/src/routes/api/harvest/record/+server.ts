/**
 * POST /api/harvest/record
 *
 * Records a harvest event for a planting. Validates that the block + crop
 * exist; quantity + lot number are free-form to accommodate field practice
 * (e.g., "12 bushels", "lot 2026-A-7").
 */

import { json, type RequestHandler } from '@sveltejs/kit';
import { z } from 'zod';
import { getBlock } from '$lib/db/blocks';
import { insertHarvestEvent } from '$lib/db/harvestEvents';
import { getRegistry } from '$lib/server/registry';

const requestSchema = z.object({
  blockId: z.string().min(1),
  cropId: z.string().optional(),
  taskId: z.string().optional(),
  cropPluginId: z.string().min(1),
  occurredAt: z.number().int().optional(),
  quantity: z.string().max(60).optional(),
  lotNumber: z.string().max(40).optional()
});

export const POST: RequestHandler = async ({ request }) => {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'invalid JSON body' }, { status: 400 });
  }
  const parsed = requestSchema.safeParse(body);
  if (!parsed.success) {
    return json({ error: 'invalid request', issues: parsed.error.issues }, { status: 400 });
  }
  if (!getBlock(parsed.data.blockId)) {
    return json({ error: 'unknown block' }, { status: 404 });
  }
  const registry = await getRegistry();
  const plugin = registry.get(parsed.data.cropPluginId);
  if (!plugin || plugin.plugin.type !== 'crop') {
    return json({ error: 'unknown crop plugin' }, { status: 404 });
  }
  const occurredAt = parsed.data.occurredAt ?? Date.now();
  const event = insertHarvestEvent({
    blockId: parsed.data.blockId,
    cropId: parsed.data.cropId,
    cropPluginId: parsed.data.cropPluginId,
    occurredAt,
    quantity: parsed.data.quantity,
    lotNumber: parsed.data.lotNumber
  });
  if (parsed.data.taskId) {
    try {
      const { completeTask } = await import('$lib/db/tasks');
      completeTask(parsed.data.taskId, {
        eventTable: 'harvest_event',
        eventId: event.id,
        occurredAt
      });
    } catch {
      // Non-fatal; the harvest is recorded.
    }
  }
  return json({ event });
};

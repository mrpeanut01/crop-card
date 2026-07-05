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
import { evaluateHarvestMoisture, HARVEST_MOISTURE_BLOCK } from '$lib/safety/harvestMoisture';
import { checkSeasonClosed } from '$lib/server/seasonClose';

const requestSchema = z.object({
  blockId: z.string().min(1),
  cropId: z.string().optional(),
  taskId: z.string().optional(),
  cropPluginId: z.string().min(1),
  occurredAt: z.number().int().optional(),
  quantity: z.string().max(60).optional(),
  lotNumber: z.string().max(40).optional(),
  // UC-16 — stored moisture %. When provided, the safety kernel gates
  // the commit against the family threshold (block above, warn near).
  moisturePct: z.number().min(0).max(100).optional()
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
  // UC-16 — harvest-moisture kernel gate (Phase 26A, RULES_VERSION 0.5.2).
  // Only fires when moisturePct is supplied and the resolved archetype
  // has a stored threshold. Block above threshold; the UI surfaces warn.
  if (parsed.data.moisturePct != null) {
    const cropPlugin = plugin.plugin as {
      archetype?: string;
      cropFamily?: string;
    };
    const verdict = evaluateHarvestMoisture({
      moisturePct: parsed.data.moisturePct,
      cropPlugin: cropPlugin as Parameters<typeof evaluateHarvestMoisture>[0]['cropPlugin']
    });
    if (verdict?.decision === 'block') {
      return json(
        {
          error: HARVEST_MOISTURE_BLOCK,
          message: verdict.reason,
          thresholdPct: verdict.thresholdPct
        },
        { status: 422 }
      );
    }
  }
  const occurredAt = parsed.data.occurredAt ?? Date.now();
  // UC-44 — SEASON_CLOSED gate. Refuse writes dated inside a closed season.
  const closed = checkSeasonClosed(occurredAt);
  if (closed) {
    return json(
      { error: closed.code, message: closed.message, year: closed.year },
      { status: 422 }
    );
  }
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

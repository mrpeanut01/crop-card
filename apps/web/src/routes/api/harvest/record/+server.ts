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
import { listSprayEvents } from '$lib/db/sprayEvents';
import { listInsecticideEvents } from '$lib/db/insecticideEvents';
import { listFungicideEvents } from '$lib/db/fungicideEvents';
import { getRegistry } from '$lib/server/registry';
import type { PluginRegistry } from '$lib/plugins';
import { evaluateHarvestMoisture, HARVEST_MOISTURE_BLOCK } from '$lib/safety/harvestMoisture';
import { evaluateHarvestPhi, type AppliedSpray } from '$lib/schedule/harvestPhi';

const PHI_LOOKBACK_MS = 120 * 24 * 60 * 60 * 1000;

/**
 * #324 — assemble the applied-spray facts on this block for the PHI check.
 * Insecticide + fungicide events persist `preHarvestClearAt`, so we derive
 * their PHI days from that; herbicide spray events don't, so we look up each
 * product's `preHarvestIntervalDays` from the registry.
 */
function gatherAppliedSprays(
  blockId: string,
  harvestMs: number,
  registry: PluginRegistry
): AppliedSpray[] {
  const fromMs = harvestMs - PHI_LOOKBACK_MS;
  const DAY_MS = 24 * 60 * 60 * 1000;
  const out: AppliedSpray[] = [];

  for (const ev of listInsecticideEvents({ blockId, fromMs })) {
    const phiDays = ev.preHarvestClearAt
      ? Math.round((ev.preHarvestClearAt - ev.occurredAt) / DAY_MS)
      : 0;
    if (phiDays <= 0) continue;
    for (const p of ev.products) {
      out.push({
        productName: p.displayName,
        kind: 'insecticide',
        appliedMs: ev.occurredAt,
        phiDays
      });
    }
  }

  for (const ev of listFungicideEvents({ blockId, fromMs })) {
    const phiDays = ev.preHarvestClearAt
      ? Math.round((ev.preHarvestClearAt - ev.occurredAt) / DAY_MS)
      : 0;
    if (phiDays <= 0) continue;
    for (const p of ev.products) {
      out.push({
        productName: p.displayName,
        kind: 'fungicide',
        appliedMs: ev.occurredAt,
        phiDays
      });
    }
  }

  for (const ev of listSprayEvents({ blockId, fromMs })) {
    for (const p of ev.products) {
      const rec = registry.get(p.pluginId);
      const phiDays = (rec?.plugin as { preHarvestIntervalDays?: number } | undefined)
        ?.preHarvestIntervalDays;
      if (!phiDays || phiDays <= 0) continue;
      const name = (rec?.plugin as { displayName?: string } | undefined)?.displayName ?? p.pluginId;
      out.push({ productName: name, kind: 'herbicide', appliedMs: ev.occurredAt, phiDays });
    }
  }

  return out;
}

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

  // #324 — PHI (pre-harvest interval) check. Consults recent spray /
  // insecticide / fungicide events on the block against each applied
  // product's PHI. v1 decision: WARN (non-blocking, acknowledgeable) —
  // residue timing is label-legal + grower-owned, so we surface a clear
  // warning rather than refuse the record. The harvest still commits; the
  // warning rides on the response so the operator sees it.
  const phi = evaluateHarvestPhi(
    gatherAppliedSprays(parsed.data.blockId, occurredAt, registry),
    occurredAt
  );

  const event = insertHarvestEvent({
    blockId: parsed.data.blockId,
    cropId: parsed.data.cropId,
    cropPluginId: parsed.data.cropPluginId,
    occurredAt,
    quantity: parsed.data.quantity,
    lotNumber: parsed.data.lotNumber,
    moisturePct: parsed.data.moisturePct
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
  return json({
    event,
    phiWarning: phi.decision === 'warn' ? { message: phi.message, conflicts: phi.conflicts } : null
  });
};

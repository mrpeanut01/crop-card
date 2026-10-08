/**
 * POST /api/harvest/record
 *
 * Records a harvest event for a planting. Validates that the block + crop
 * exist; quantity + lot number are free-form to accommodate field practice
 * (e.g., "12 bushels", "lot 2026-A-7").
 */

import { withClientRecordId } from '$lib/server/clientRecordId';
import { writeRecord } from '$lib/server/recordWrite';
import { closeTaskForRecord } from '$lib/server/recordTaskClose';
import type { RecordTaskClose } from '$lib/tasks/recordClose';
import { tryGuardedHoldWrite } from '$lib/server/holdGuard';
import { json, type RequestHandler } from '@sveltejs/kit';
import { harvestRecordSchema } from '$lib/records/apiSchemas';
import { getBlock } from '$lib/db/blocks';
import { harvestOnGrazingLand } from '$lib/server/areaGrazing';
import { getCrop, listCrops, type Crop } from '$lib/db/crops';
import {
  insertCropHarvestEvent,
  insertHarvestEvent,
  type HarvestEvent
} from '$lib/db/harvestEvents';
import { listSprayEvents } from '$lib/db/sprayEvents';
import { listInsecticideEvents } from '$lib/db/insecticideEvents';
import { listFungicideEvents } from '$lib/db/fungicideEvents';
import { getBaseRegistry, getRegistry } from '$lib/server/registry';
import type { PluginRegistry } from '$lib/plugins';
import { evaluateHarvestMoisture, HARVEST_MOISTURE_BLOCK } from '$lib/safety/harvestMoisture';
import { checkSeasonClosed } from '$lib/server/seasonClose';
import { t } from '$lib/i18n';
import { rejectForeignRefsIn } from '$lib/server/foreignRefs';
import { evaluateHarvestPhi, type AppliedSpray } from '$lib/schedule/harvestPhi';
import { resolveArchetype } from '$lib/plugins/schemas';
import { hayCutGate } from '$lib/server/grazingGate';
import { RULES_VERSION } from '$lib/safety/version';
import { phiDaysForCrop, type PhiProduct } from '$lib/safety/preHarvestInterval';
import { phiCropOf } from '$lib/server/phiCrops';
import { currentUser } from '$lib/server/auth';
import { farmTimeZone } from '$lib/db/userProfile';

const FUTURE_SLACK_MS = 5 * 60 * 1000;
const PHI_LOOKBACK_MS = 120 * 24 * 60 * 60 * 1000;

/**
 * #324 — assemble the applied-spray facts on this block for the PHI check.
 * Insecticide + fungicide events persist `preHarvestClearAt`, so we derive
 * their PHI days from that; herbicide spray events don't, so we look up each
 * product's PHI for the harvested crop from the registry (#661).
 */
function gatherAppliedSprays(
  blockId: string,
  harvestMs: number,
  registry: PluginRegistry,
  cropPluginId: string
): AppliedSpray[] {
  const crop = phiCropOf(registry, cropPluginId);
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
      const phiDays = rec ? phiDaysForCrop(rec.plugin as PhiProduct, crop).days : null;
      if (!phiDays || phiDays <= 0) continue;
      const name = (rec?.plugin as { displayName?: string } | undefined)?.displayName ?? p.pluginId;
      out.push({ productName: name, kind: 'herbicide', appliedMs: ev.occurredAt, phiDays });
    }
  }

  return out;
}

export const _requestSchema = harvestRecordSchema;
const requestSchema = harvestRecordSchema;

type CropPluginShape = Parameters<typeof resolveArchetype>[0] & {
  hayOperations?: unknown;
  cropFamily?: string;
};

/** A forage by any reading of its data: hay operations, the forage family
 *  or the forage archetype. */
function isForage(plugin: CropPluginShape | undefined, override?: string | null): boolean {
  if (override === 'forage-cutting-cycle') return true;
  if (!plugin) return false;
  if (
    plugin.hayOperations ||
    plugin.cropFamily === 'forage' ||
    plugin.cropFamily === 'forage-grass'
  )
    return true;
  return resolveArchetype(plugin) === 'forage-cutting-cycle';
}

/**
 * C-28: whether this harvest is a hay cut, decided from what is growing and
 * not only from the label the client sends. The farm's copy of a plugin
 * and the shared one are both read, so a farm copy can only turn the gate
 * on (Invariant 1); a planting's archetype override can only turn it on
 * too. A block with a forage planting on it is gated unless the declared
 * crop is itself planted there. Anything cut on grazing land (a pasture
 * kind, or an Area animals have stayed on when the declared crop is not
 * planted on the block, `harvestOnGrazingLand`) is a hay cut whatever
 * crop it names (C-35 §0: a harvest on a grazeable block is a declaration).
 */
function isHayCut(input: {
  cropPluginId: string;
  planting: Crop | undefined;
  blockPlantings: readonly Crop[];
  farm: PluginRegistry;
  base: PluginRegistry;
  onGrazingLand: boolean;
}): boolean {
  if (input.onGrazingLand) return true;
  const both = (pluginId: string, override?: string | null) =>
    isForage(input.farm.get(pluginId)?.plugin as CropPluginShape | undefined, override) ||
    isForage(input.base.get(pluginId)?.plugin as CropPluginShape | undefined, override);
  if (both(input.cropPluginId)) return true;
  if (input.planting && both(input.planting.cropPluginId, input.planting.archetypeOverride)) {
    return true;
  }
  const forageHere = input.blockPlantings.some((c) => both(c.cropPluginId, c.archetypeOverride));
  const declaredHere = input.blockPlantings.some((c) => c.cropPluginId === input.cropPluginId);
  return forageHere && !declaredHere;
}

export const POST: RequestHandler = withClientRecordId(async (requestEvent) => {
  const { request } = requestEvent;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json(
      { error: t(requestEvent.locals?.locale, 'stockui.api.invalidJson') },
      { status: 400 }
    );
  }
  const parsed = requestSchema.safeParse(body);
  if (!parsed.success) {
    return json(
      {
        error: t(requestEvent.locals?.locale, 'stockui.api.invalidRequest'),
        issues: parsed.error.issues
      },
      { status: 400 }
    );
  }
  const block = getBlock(parsed.data.blockId);
  if (!block) {
    return json({ error: t(requestEvent.locals?.locale, 'api.err.unknownBlock') }, { status: 404 });
  }
  const foreign = rejectForeignRefsIn(requestEvent.locals?.locale, [
    'cropId',
    parsed.data.cropId,
    getCrop
  ]);
  if (foreign) return foreign;
  const registry = await getRegistry();
  const plugin = registry.get(parsed.data.cropPluginId);
  if (!plugin || plugin.plugin.type !== 'crop') {
    return json(
      { error: t(requestEvent.locals?.locale, 'api.err.unknownCropPlugin') },
      { status: 404 }
    );
  }
  const planting = parsed.data.cropId ? getCrop(parsed.data.cropId) : undefined;
  if (planting && planting.cropPluginId !== parsed.data.cropPluginId) {
    return json(
      {
        error: 'CROP_MISMATCH',
        message: t(requestEvent.locals?.locale, 'api.err.cropMismatchCrop')
      },
      { status: 400 }
    );
  }
  if (planting && planting.blockId !== block.id) {
    return json(
      {
        error: 'CROP_MISMATCH',
        message: t(requestEvent.locals?.locale, 'api.err.cropMismatchBlock')
      },
      { status: 400 }
    );
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
  // A future date would skip the PHI warning for sprays still inside their
  // interval; hay cuttings already refuse it.
  if (occurredAt > Date.now() + FUTURE_SLACK_MS) {
    return json(
      { error: t(requestEvent.locals?.locale, 'harvestui.err.future'), code: 'IN_THE_FUTURE' },
      { status: 400 }
    );
  }
  // UC-44 — SEASON_CLOSED gate. Refuse writes dated inside a closed season.
  const closed = checkSeasonClosed(occurredAt, requestEvent.locals?.locale);
  if (closed) {
    return json(
      { error: closed.code, message: closed.message, year: closed.year },
      { status: 422 }
    );
  }

  const base = await getBaseRegistry();
  // Every await is above this line: the hay-or-not decision reads the
  // block and its Area as they are now, and a harvest that is not a hay
  // cut is written with no await in between, so a concurrent Area kind
  // change or block move cannot slip a hay cut past the gate and guard.
  const here = getBlock(block.id);
  if (!here) {
    return json({ error: t(requestEvent.locals?.locale, 'api.err.unknownBlock') }, { status: 404 });
  }
  let hayRulesVersion: string | undefined;
  const blockPlantings = listCrops({ blockId: here.id, statuses: ['planned', 'active'] });
  const declaredPlantedHere =
    planting?.blockId === here.id ||
    blockPlantings.some((c) => c.cropPluginId === parsed.data.cropPluginId);
  const hayCut = isHayCut({
    cropPluginId: parsed.data.cropPluginId,
    planting,
    blockPlantings,
    farm: registry,
    base,
    onGrazingLand: harvestOnGrazingLand(here.fieldId, declaredPlantedHere)
  });
  if (hayCut) {
    const auth = currentUser(requestEvent);
    const hayGate = await hayCutGate(
      here.id,
      here.fieldId ?? null,
      Math.min(occurredAt, Date.now()),
      auth?.role ?? 'helper',
      farmTimeZone()
    );
    if (!hayGate.ok) return json(hayGate.body, { status: hayGate.status });
    hayRulesVersion = RULES_VERSION;
  }

  // #324 — PHI (pre-harvest interval) check. Consults recent spray /
  // insecticide / fungicide events on the block against each applied
  // product's PHI. v1 decision: WARN (non-blocking, acknowledgeable) —
  // residue timing is label-legal + grower-owned, so we surface a clear
  // warning rather than refuse the record. The harvest still commits; the
  // warning rides on the response so the operator sees it.
  const phi = evaluateHarvestPhi(
    gatherAppliedSprays(parsed.data.blockId, occurredAt, registry, parsed.data.cropPluginId),
    occurredAt
  );

  const input = {
    blockId: parsed.data.blockId,
    cropId: parsed.data.cropId,
    cropPluginId: parsed.data.cropPluginId,
    occurredAt,
    quantity: parsed.data.quantity,
    lotNumber: parsed.data.lotNumber,
    moisturePct: parsed.data.moisturePct,
    details: parsed.data.details,
    performedById: currentUser(requestEvent)?.id
  };
  let taskClose: RecordTaskClose | null = null;
  const closeTask = (event: HarvestEvent) => {
    taskClose = closeTaskForRecord({
      taskId: parsed.data.taskId,
      record: {
        blockId: parsed.data.blockId,
        cropId: parsed.data.cropId,
        cropPluginId: parsed.data.cropPluginId
      },
      eventTable: 'harvest_event',
      eventId: event.id,
      occurredAt
    });
    return event;
  };
  // C-35: a harvest on a forage block is a hay declaration, checked by the
  // hold guard like a hay cut. Any other harvest is no hold fact.
  let event;
  if (hayCut) {
    const guarded = await tryGuardedHoldWrite(
      requestEvent,
      currentUser(requestEvent),
      () => closeTask(insertHarvestEvent({ ...input, rulesVersion: hayRulesVersion })),
      { dated: true }
    );
    if (!guarded.ok) return guarded.response;
    event = guarded.value;
  } else {
    event = writeRecord({ request }, () => closeTask(insertCropHarvestEvent(input)));
  }
  return json({
    event,
    phiWarning: phi.decision === 'warn' ? { message: phi.message, conflicts: phi.conflicts } : null,
    taskClose
  });
});

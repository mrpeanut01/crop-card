import type { PageServerLoad } from './$types';
import { listBlocks } from '$lib/db/blocks';
import { listHarvestEvents } from '$lib/db/harvestEvents';
import type { Archetype, CropPlugin, HarvestStyle } from '$lib/plugins/schemas';
import type { RendererData } from '$lib/components/harvest/renderers/types';
import { forageCutWindow, plantingHarvestKey } from '$lib/harvest/forageWindow';
import { getRegistry } from '$lib/server/registry';
import { canSetUp, setupAreas, setupBlocks } from '$lib/server/setupContext';
import { canSeeMoney } from '$lib/finance/redact';
import { hasAnyLedgerEntry } from '$lib/db/ledger';
import { complianceChromeLevel } from '$lib/records/complianceChrome';
import { getFarmProfile } from '$lib/onboarding/state.server';
import { listSprayEvents } from '$lib/db/sprayEvents';
import { listInsecticideEvents } from '$lib/db/insecticideEvents';
import { listFungicideEvents } from '$lib/db/fungicideEvents';
import { canMutate } from '$lib/server/session';
import { dispositionViewsFor } from '$lib/server/harvestDispositions';
import { farmHasOrganicStatus } from '$lib/harvest/organicAtHarvest.server';
import { loadTaskContext } from '$lib/server/recordTaskClose';
import { harvestWindowFor } from '$lib/calendar/harvestWindow';
import { plantingOnView } from '$lib/plan/planV2Derive';
import { isPerennialCrop } from '$lib/plugins/perennial';

/** F2-15: owners see "Record a sale"; a quiet garden household only once
 *  the farm has any ledger entry. Helpers never see it. */
function canRecordSale(role: string | undefined): boolean {
  if (!canSeeMoney(role)) return false;
  if (hasAnyLedgerEntry()) return true;
  const chrome = complianceChromeLevel(getFarmProfile(), {
    sprays: listSprayEvents({ limit: 1 }).length,
    insecticides: listInsecticideEvents({ limit: 1 }).length,
    fungicides: listFungicideEvents({ limit: 1 }).length
  });
  return chrome === 'full';
}

const DAY_MS = 24 * 60 * 60 * 1000;

export type HarvestStatus = 'too-early' | 'in-window' | 'past' | 'unknown';

export type { RendererData };

export interface PlantingHarvestStatus {
  blockId: string;
  blockName: string;
  plantingId: string;
  cropPluginId: string;
  varietyDisplayName: string;
  cropFamily?: string;
  /** Phase 25c.0 #87 — legacy discriminator. Phase 27A prefers
   *  `archetype` (plugin-declared) + `archetypeOverride` (planting-level);
   *  HarvestRouter resolves through `resolveArchetype()` when archetype
   *  is absent. */
  harvestStyle?: HarvestStyle;
  /** Phase 27A — explicit plugin archetype. */
  archetype?: Archetype;
  /** Phase 27A — per-planting operator override (migration 0039). */
  archetypeOverride?: Archetype | null;
  plantingDate: number | null;
  windowStartMs?: number;
  windowEndMs?: number;
  status: HarvestStatus;
  daysUntilWindow?: number;
  daysIntoWindow?: number;
  daysPastWindow?: number;
  harvestIndicators: string[];
  alreadyHarvested: boolean;
  /** Sprint 9 — archetype-renderer payload. */
  rendererData: RendererData;
}

export const load: PageServerLoad = async ({ url, locals }) => {
  // ?crop=<id> aliases ?planting=<id> for Phase 12D crop-attribution
  // navigation. Both fall through to the planting-status loop below.
  const focusPlantingId = url.searchParams.get('crop') ?? url.searchParams.get('planting') ?? null;
  const taskContext = loadTaskContext(url.searchParams.get('task'));
  const blocks = listBlocks();
  const registry = await getRegistry();
  const all = listHarvestEvents();
  const harvestedSet = new Set(
    all.map((e) =>
      plantingHarvestKey({
        cropId: e.cropId,
        blockId: e.blockId,
        cropPluginId: e.cropPluginId
      })
    )
  );

  const now = Date.now();
  const plantings: PlantingHarvestStatus[] = [];

  const lastPickByPlanting = new Map<string, number>();
  const pickCountByPlanting = new Map<string, number>();
  for (const e of all) {
    const k = plantingHarvestKey({
      cropId: e.cropId,
      blockId: e.blockId,
      cropPluginId: e.cropPluginId
    });
    const prev = lastPickByPlanting.get(k);
    if (prev === undefined || e.occurredAt > prev) lastPickByPlanting.set(k, e.occurredAt);
    pickCountByPlanting.set(k, (pickCountByPlanting.get(k) ?? 0) + 1);
  }

  for (const b of blocks) {
    for (const p of b.plantings) {
      const rec = registry.get(p.cropPluginId);
      const crop = rec?.plugin.type === 'crop' ? (rec.plugin as CropPlugin) : undefined;
      if (p.id !== focusPlantingId && !plantingOnView(p, !!crop && isPerennialCrop(crop))) {
        continue;
      }
      const key = plantingHarvestKey({ cropId: p.id, blockId: b.id, cropPluginId: p.cropPluginId });
      const priorPickCount = pickCountByPlanting.get(key) ?? 0;
      const lastPickMs = lastPickByPlanting.get(key);
      const hayOps = crop?.hayOperations;

      let status: HarvestStatus = 'unknown';
      let windowStartMs: number | undefined;
      let windowEndMs: number | undefined;
      let daysUntilWindow: number | undefined;
      let daysIntoWindow: number | undefined;
      let daysPastWindow: number | undefined;

      const isForage =
        crop?.archetype === 'forage-cutting-cycle' || crop?.harvestStyle === 'forage-cutting-cycle';
      const forageWindow = forageCutWindow({
        isForage,
        lastPickMs,
        cutIntervalDays: hayOps?.cutIntervalDays
      });
      if (forageWindow) {
        windowStartMs = forageWindow.windowStartMs;
        windowEndMs = forageWindow.windowEndMs;
      } else if (crop && p.plantingDate !== null) {
        const window = harvestWindowFor(p, crop, { now, blockPlantings: b.plantings });
        windowStartMs = window?.startMs;
        windowEndMs = window?.endMs;
      }

      if (windowStartMs !== undefined && windowEndMs !== undefined) {
        if (now < windowStartMs) {
          status = 'too-early';
          daysUntilWindow = Math.ceil((windowStartMs - now) / DAY_MS);
        } else if (now <= windowEndMs) {
          status = 'in-window';
          daysIntoWindow = Math.floor((now - windowStartMs) / DAY_MS);
        } else {
          status = 'past';
          daysPastWindow = Math.floor((now - windowEndMs) / DAY_MS);
        }
      }

      plantings.push({
        blockId: b.id,
        blockName: b.name,
        plantingId: p.id,
        cropPluginId: p.cropPluginId,
        varietyDisplayName: p.varietyDisplayName,
        cropFamily: crop?.cropFamily,
        harvestStyle: crop?.harvestStyle,
        archetype: crop?.archetype,
        archetypeOverride:
          (p as { archetypeOverride?: Archetype | null }).archetypeOverride ?? null,
        plantingDate: p.plantingDate,
        windowStartMs,
        windowEndMs,
        status,
        daysUntilWindow,
        daysIntoWindow,
        daysPastWindow,
        harvestIndicators: crop?.harvestIndicators ?? [],
        alreadyHarvested: harvestedSet.has(key),
        rendererData: {
          hayOperations: hayOps,
          zadoksStages: crop?.zadoksStages,
          moistureGates: crop?.moistureGates,
          priorPickCount
        }
      });
    }
  }

  plantings.sort((a, b) => {
    const order: Record<HarvestStatus, number> = {
      'in-window': 0,
      past: 1,
      'too-early': 2,
      unknown: 3
    };
    if (order[a.status] !== order[b.status]) return order[a.status] - order[b.status];
    return (a.windowStartMs ?? Infinity) - (b.windowStartMs ?? Infinity);
  });

  // FR-08: enrich each recorded harvest with curing-status from the crop
  // plugin's postHarvestCuring data so the operator sees countdown to ready.
  const blockNameById = new Map(blocks.map((b) => [b.id, b.name]));
  const recordedHarvests = all.map((h) => {
    const rec = registry.get(h.cropPluginId);
    const crop = rec?.plugin.type === 'crop' ? (rec.plugin as CropPlugin) : undefined;
    const curing = crop?.postHarvestCuring;
    const blockName = blockNameById.get(h.blockId) ?? null;
    if (!curing) {
      return { ...h, blockName, curing: null };
    }
    const minMs = h.occurredAt + curing.durationWeeks.min * 7 * DAY_MS;
    const maxMs = h.occurredAt + curing.durationWeeks.max * 7 * DAY_MS;
    let phase: 'in-progress' | 'ready' | 'overdue';
    let daysRemaining: number;
    if (now < minMs) {
      phase = 'in-progress';
      daysRemaining = Math.ceil((minMs - now) / DAY_MS);
    } else if (now <= maxMs) {
      phase = 'ready';
      daysRemaining = Math.ceil((maxMs - now) / DAY_MS);
    } else {
      phase = 'overdue';
      daysRemaining = Math.floor((now - maxMs) / DAY_MS);
    }
    return {
      ...h,
      blockName,
      curing: {
        method: curing.method,
        minWeeks: curing.durationWeeks.min,
        maxWeeks: curing.durationWeeks.max,
        targetMoisturePercent: curing.targetMoisturePercent,
        storageLocation: curing.storageLocation,
        readyMs: minMs,
        overdueMs: maxMs,
        phase,
        daysRemaining
      }
    };
  });

  const role = locals.user?.role;
  return {
    plantings,
    recordedHarvests,
    dispositions: dispositionViewsFor(
      all.map((h) => h.id),
      role
    ),
    askSoldAsOrganic: farmHasOrganicStatus(),
    canWriteRecords: !!role && canMutate(role),
    isOwner: role === 'owner',
    focusPlantingId,
    taskContext,
    canRecordSale: canRecordSale(role),
    setup: {
      canEdit: canSetUp(locals.user?.role),
      areas: setupAreas(),
      blocks: setupBlocks(blocks)
    }
  };
};

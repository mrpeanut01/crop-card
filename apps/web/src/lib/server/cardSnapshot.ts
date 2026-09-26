/**
 * Phase 30F: assembles the offline Card bundle (`FarmSnapshot`) for the
 * active Owner. Every read goes through a tenant-scoped repo; the crop and
 * pesticide plugins come from the Owner's registry view.
 */

import { createHash } from 'node:crypto';
import {
  FARM_SNAPSHOT_VERSION,
  type FarmSnapshot,
  type SnapshotArea,
  type SnapshotBlock,
  type SnapshotCropPlugin,
  type SnapshotEquipment,
  type SnapshotSprayProduct,
  type SnapshotStockItem
} from '$lib/cards/snapshot';
import { snapshotFrostFromSettings } from '$lib/climate/frostSettings.server';
import { loadEmergencyContacts } from '$lib/farm/emergencyContacts.server';
import { listAreas } from '$lib/db/areas';
import { listBlocks } from '$lib/db/blocks';
import {
  activeOwnerName,
  listOpenTasksForCards,
  listPlantingsForCards
} from '$lib/db/cardSnapshot';
import { listEquipment } from '$lib/db/equipment';
import { listStockItems } from '$lib/db/stock';
import { requireOwnerId } from '$lib/db/tenant';
import type { Plugin } from '$lib/plugins/schemas';
import { pollinatorDataFor } from '$lib/safety/pollinatorProtection';
import { buildTankMixSteps } from '$lib/safety/tankMixOrder';
import { RULES_VERSION } from '$lib/safety/version';
import { getRegistry } from './registry';

const DAY_MS = 86_400_000;
export const SNAPSHOT_TASK_PAST_DAYS = 14;
export const SNAPSHOT_TASK_FUTURE_DAYS = 30;

const PESTICIDE_TYPES = new Set(['herbicide', 'insecticide', 'fungicide']);

function positive(n: unknown): number | null {
  return typeof n === 'number' && Number.isFinite(n) && n > 0 ? n : null;
}

function toArea(a: ReturnType<typeof listAreas>[number]): SnapshotArea {
  return {
    id: a.id,
    name: a.name,
    kind: a.kind,
    acres: a.acres ?? null,
    widthFt: a.widthFt ?? null,
    lengthFt: a.lengthFt ?? null,
    perimeterFt: a.perimeterFt ?? null,
    acresSource: a.acresSource ?? null,
    notes: a.notes ?? null
  };
}

function toBlock(b: ReturnType<typeof listBlocks>[number]): SnapshotBlock {
  const hasLayout =
    b.xFt !== undefined ||
    b.yFt !== undefined ||
    b.rotationDeg !== undefined ||
    b.bedStyle !== undefined;
  return {
    id: b.id,
    areaId: b.fieldId ?? null,
    name: b.name,
    blockLabel: b.blockLabel ?? null,
    kind: b.kind ?? 'block',
    acres: b.acres ?? null,
    widthFt: b.widthFt ?? null,
    lengthFt: b.lengthFt ?? null,
    layout: hasLayout
      ? {
          xFt: b.xFt ?? null,
          yFt: b.yFt ?? null,
          rotationDeg: b.rotationDeg ?? null,
          bedStyle: b.bedStyle ?? null
        }
      : null
  };
}

function toEquipment(e: ReturnType<typeof listEquipment>[number]): SnapshotEquipment {
  const s = e.state;
  return {
    id: e.id,
    type: e.type,
    label: e.label,
    tankGal: positive(e.spec?.tankGal),
    state: {
      calibratedGpa: s.calibratedGpa ?? null,
      calibrationDate: s.calibrationDate ?? null,
      lastDeconAt: s.lastDeconAt ?? null,
      lastUsedAt: s.lastUsedAt ?? null,
      lastChemistryClass: s.lastChemistryClass ?? null,
      winterizedAt: s.winterizedAt ?? null
    }
  };
}

function toStock(i: ReturnType<typeof listStockItems>[number]): SnapshotStockItem {
  return {
    id: i.id,
    pluginId: i.pluginId ?? null,
    category: i.category,
    displayName: i.displayName,
    unit: i.defaultUnit,
    onHand: i.onHand,
    reorderThreshold: i.reorderThreshold ?? null,
    earliestExpiry: i.earliestExpiry ? new Date(i.earliestExpiry).toISOString().slice(0, 10) : null
  };
}

function toCropPlugin(p: Plugin): SnapshotCropPlugin | null {
  if (p.type !== 'crop') return null;
  return {
    pluginId: p.pluginId,
    displayName: p.displayName,
    version: p.version,
    cropFamily: p.cropFamily,
    archetype: p.archetype,
    daysToMaturity: p.daysToMaturity,
    defaultRowSpacingInches: p.defaultRowSpacingInches,
    preHarvestIntervalDays: p.preHarvestIntervalDays,
    plantingGuide: p.plantingGuide
      ? {
          rowSpacingIn: p.plantingGuide.rowSpacingIn,
          inRowSpacingIn: p.plantingGuide.inRowSpacingIn,
          seedDepthIn: p.plantingGuide.seedDepthIn,
          soilTempMinF: p.plantingGuide.soilTempMinF
        }
      : undefined,
    harvestIndicators: p.harvestIndicators,
    notes: p.notes
  };
}

export function toSprayProduct(p: Plugin): SnapshotSprayProduct | null {
  if (p.type === 'herbicide') {
    return {
      pluginId: p.pluginId,
      type: 'herbicide',
      displayName: p.displayName,
      version: p.version,
      epaRegistrationNumber: p.epaRegistrationNumber ?? null,
      ratePerAcre: p.ratePerAcre,
      gpaCalibration: p.gpaCalibration ?? null,
      reEntryIntervalHours: null,
      preHarvestIntervalDays: null,
      targets: [],
      loadClasses: [...new Set(p.activeIngredients.map((ai) => ai.chemistryClass))],
      mixSteps: buildTankMixSteps([p]).map((s) => s.instruction),
      rainfastHours: null,
      pollinator: null
    };
  }
  if (p.type === 'insecticide') {
    return {
      pluginId: p.pluginId,
      type: 'insecticide',
      displayName: p.displayName,
      version: p.version,
      epaRegistrationNumber: p.epaRegistrationNumber ?? null,
      ratePerAcre: p.ratePerAcre ?? null,
      gpaCalibration: p.gpaCalibration ?? null,
      reEntryIntervalHours: p.reEntryIntervalHours,
      preHarvestIntervalDays: p.preHarvestIntervalDays ?? null,
      targets: p.targetPests ?? [],
      loadClasses: ['insecticide-load'],
      mixSteps: [],
      rainfastHours: null,
      pollinator: (({ beeToxicity, bloomRestriction }) => ({ beeToxicity, bloomRestriction }))(
        pollinatorDataFor(p)
      )
    };
  }
  if (p.type === 'fungicide') {
    return {
      pluginId: p.pluginId,
      type: 'fungicide',
      displayName: p.displayName,
      version: p.version,
      epaRegistrationNumber: p.epaRegistrationNumber ?? null,
      ratePerAcre: p.ratePerAcre,
      gpaCalibration: p.gpaCalibration ?? null,
      reEntryIntervalHours: p.reEntryIntervalHours,
      preHarvestIntervalDays: p.preHarvestIntervalDays,
      targets: p.targetDiseases ?? [],
      loadClasses: ['fungicide-load'],
      mixSteps: [],
      rainfastHours: p.rainfastHours ?? null,
      pollinator: null
    };
  }
  return null;
}

export interface BuildSnapshotOptions {
  now?: number;
  origin?: string | null;
}

export async function buildFarmSnapshot(opts: BuildSnapshotOptions = {}): Promise<FarmSnapshot> {
  const ownerId = requireOwnerId();
  const now = opts.now ?? Date.now();
  const registry = await getRegistry();

  const plantings = listPlantingsForCards(now);
  const cropPlugins: Record<string, SnapshotCropPlugin> = {};
  for (const id of new Set(plantings.map((p) => p.cropPluginId))) {
    const rec = registry.get(id);
    const plugin = rec ? toCropPlugin(rec.plugin) : null;
    if (plugin) cropPlugins[id] = plugin;
  }

  const stockItems = listStockItems();
  const sprayProducts: Record<string, SnapshotSprayProduct> = {};
  for (const item of stockItems) {
    if (!item.pluginId || !PESTICIDE_TYPES.has(item.category)) continue;
    const rec = registry.get(item.pluginId);
    const product = rec ? toSprayProduct(rec.plugin) : null;
    if (product) sprayProducts[product.pluginId] = product;
  }

  return {
    version: FARM_SNAPSHOT_VERSION,
    ownerId,
    farmName: activeOwnerName(),
    generatedAt: now,
    rulesVersion: RULES_VERSION,
    origin: opts.origin ?? null,
    areas: listAreas().map(toArea),
    blocks: listBlocks()
      .map(toBlock)
      .sort((a, b) => a.id.localeCompare(b.id)),
    plantings,
    tasks: listOpenTasksForCards(
      now - SNAPSHOT_TASK_PAST_DAYS * DAY_MS,
      now + SNAPSHOT_TASK_FUTURE_DAYS * DAY_MS
    ),
    equipment: listEquipment()
      .filter((e) => e.retiredAt === undefined)
      .map(toEquipment)
      .sort((a, b) => a.label.localeCompare(b.label) || a.id.localeCompare(b.id)),
    stock: stockItems.map(toStock).sort((a, b) => a.id.localeCompare(b.id)),
    cropPlugins,
    frost: snapshotFrostFromSettings(),
    sprayProducts,
    emergencyContacts: loadEmergencyContacts()
  };
}

/** Weak validator over everything but `generatedAt`, so an unchanged farm
 *  answers 304 even though every build stamps a new time. */
export function snapshotEtag(snapshot: FarmSnapshot): string {
  const { generatedAt: _generatedAt, ...rest } = snapshot;
  const digest = createHash('sha256').update(JSON.stringify(rest)).digest('base64url');
  return `W/"${digest.slice(0, 32)}"`;
}

export function etagMatches(ifNoneMatch: string | null, etag: string): boolean {
  if (!ifNoneMatch) return false;
  const bare = (t: string) => t.trim().replace(/^W\//, '');
  const want = bare(etag);
  return ifNoneMatch.split(',').some((t) => t.trim() === '*' || bare(t) === want);
}

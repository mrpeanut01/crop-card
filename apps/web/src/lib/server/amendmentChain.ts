/**
 * Phase 33C (M-40): loads every fact the carryover chain needs once per
 * request, through the tenant-scoped repos, and hands it to the pure
 * `computeChains()`. Never stored. Reads the grazing loader read-only
 * (M-25): live and deleted applications, farm-copy-merged label data.
 */

import {
  computeChains,
  type CarryoverChain,
  type ChainApplication,
  type ChainCutting,
  type ChainFeedUse,
  type ChainLot,
  type ChainSource,
  type SubjectRef
} from '$lib/amendments/carryover';
import {
  listBatchInputs,
  listBatches,
  listHayFeedUses,
  listHayLots,
  listLotsById,
  type AmendmentBatch,
  type AmendmentBatchInput,
  type AmendmentLot
} from '$lib/db/amendments';
import { listAnimals } from '$lib/db/animals';
import { animalLabel } from '$lib/animals/display';
import { listAnimalGroups } from '$lib/db/animalGroups';
import { listBlocks } from '$lib/db/blocks';
import { listFields } from '$lib/db/fields';
import { listAllCuttings } from '$lib/db/hayCuttings';
import { parseFeedUseNote } from '$lib/stock/animalStock';
import {
  applicationFieldId,
  hasManureCarryover,
  type GrazingApplication
} from '$lib/safety/grazingInterval';
import { fieldOfBlocks, grazingContextFrom } from '$lib/server/areaGrazing';
import { getBaseRegistry, getRegistry } from '$lib/server/registry';
import type { PluginRegistry } from '$lib/plugins/registry';
import { manureSources } from './animalFoodGate';
import { t } from '$lib/i18n';

function carryoverDays(a: GrazingApplication): number | null {
  const d = (a.restrictions as { manureCarryoverDays?: unknown } | null)?.manureCarryoverDays;
  return typeof d === 'number' && Number.isFinite(d) && d >= 0 ? d : null;
}

function hasPlugin(registry: PluginRegistry, base: PluginRegistry, pluginId: string | null) {
  return !!pluginId && (registry.get(pluginId) !== undefined || base.get(pluginId) !== undefined);
}

/**
 * M-25: carryover applications plus herbicide sprays with no plugin. A
 * product read twice (current data and the snapshot it was saved with) is
 * merged: it carries over when either reading does, and its days are
 * unknown when any carrying reading lacks them.
 */
export function chainApplications(
  applications: readonly GrazingApplication[],
  registry: PluginRegistry,
  base: PluginRegistry,
  fieldOf: ReadonlyMap<string, string | null>
): ChainApplication[] {
  const merged = new Map<string, ChainApplication>();
  for (const a of applications) {
    const unknownProduct = a.source === 'spray' && !hasPlugin(registry, base, a.productPluginId);
    const carries = hasManureCarryover([a]);
    if (!carries && !unknownProduct) continue;
    const key = `${a.ref}|${a.productPluginId ?? a.productName}`;
    const days = carries ? carryoverDays(a) : null;
    const prev = merged.get(key);
    if (prev) {
      prev.manureCarryoverDays =
        prev.manureCarryoverDays === null || days === null
          ? null
          : Math.max(prev.manureCarryoverDays, days);
      prev.unknownProduct = prev.unknownProduct && unknownProduct;
      continue;
    }
    merged.set(key, {
      ref: a.ref,
      blockId: a.blockId,
      fieldId: applicationFieldId(a, fieldOf),
      appliedAtMs: a.appliedAtMs,
      productName: a.productName,
      productPluginId: a.productPluginId,
      manureCarryoverDays: days,
      unknownProduct
    });
  }
  return [...merged.values()];
}

export interface ChainNames {
  animals: Map<string, string>;
  groups: Map<string, string>;
  fields: Map<string, string>;
  blocks: Map<string, string>;
  batches: Map<string, string>;
  lots: Map<string, AmendmentLot>;
}

export function subjectName(
  names: ChainNames,
  type: 'animal' | 'group',
  id: string,
  locale?: string | null
): string {
  return (
    (type === 'animal' ? names.animals.get(id) : names.groups.get(id)) ??
    t(locale, type === 'animal' ? 'amend.name.anAnimal' : 'amend.name.aGroup')
  );
}

export function lotLabel(lot: AmendmentLot | undefined, locale?: string | null): string {
  if (!lot) return t(locale, 'amend.name.lotGone');
  return lot.lotNumber
    ? t(locale, 'amend.name.withLot', { item: lot.itemName, lot: lot.lotNumber })
    : lot.itemName;
}

export interface LoadedChains {
  chains: Map<string, CarryoverChain>;
  batches: AmendmentBatch[];
  inputs: AmendmentBatchInput[];
  names: ChainNames;
}

/** The full load, with names for the inventory pages. */
export async function loadCarryoverData(nowMs: number = Date.now()): Promise<LoadedChains> {
  const batches = listBatches();
  const inputs = batches.length ? listBatchInputs() : [];
  const names: ChainNames = {
    animals: new Map(listAnimals({ status: 'all' }).map((a) => [a.id, animalLabel(a)])),
    groups: new Map(listAnimalGroups({ status: 'all' }).map((g) => [g.id, g.name])),
    fields: new Map(listFields().map((f) => [f.id, f.name])),
    blocks: new Map(listBlocks({ plantings: 'none' }).map((b) => [b.id, b.name])),
    batches: new Map(batches.map((b) => [b.id, b.name])),
    lots: new Map()
  };
  if (batches.length === 0) return { chains: new Map(), batches, inputs, names };

  const [registry, base] = await Promise.all([getRegistry(), getBaseRegistry()]);
  const grazing = grazingContextFrom(registry, base, nowMs, {
    fromAtMs: Number.NEGATIVE_INFINITY
  });
  const applications = chainApplications(grazing.applications, registry, base, fieldOfBlocks());

  const batchById = new Map(batches.map((b) => [b.id, b]));
  const ref = (type: 'animal' | 'group', id: string): SubjectRef => ({
    type,
    id,
    name: subjectName(names, type, id)
  });
  const sources = new Map<string, ChainSource>();
  for (const i of inputs) {
    if (i.inputType !== 'animal' && i.inputType !== 'group') continue;
    const batch = batchById.get(i.batchId);
    const window = { fromMs: i.fromAt, toMs: i.toAt ?? batch?.closedAt ?? nowMs };
    const found = manureSources({ type: i.inputType, id: i.inputId }, window);
    sources.set(i.id, {
      stays: found.stays.map((s) => ({
        subject: ref(s.subjectType, s.subjectId),
        fieldId: s.fieldId,
        fromMs: s.fromMs,
        toMs: s.toMs
      })),
      feedReach: found.feedReach.map((r) => ({
        subject: { type: r.subjectType, id: r.subjectId },
        fromMs: r.fromMs,
        toMs: r.toMs
      })),
      missing: found.missing
    });
  }

  const hayLots = listHayLots();
  const inputLotIds = inputs.filter((i) => i.inputType === 'stock-lot').map((i) => i.inputId);
  for (const l of [...hayLots, ...listLotsById(inputLotIds)]) names.lots.set(l.id, l);
  const lots = new Map<string, ChainLot>(
    [...names.lots.values()].map((l) => [
      l.id,
      { id: l.id, name: lotLabel(l), cuttingId: l.sourceHayCuttingId }
    ])
  );
  const cuttingIds = new Set(
    [...names.lots.values()].map((l) => l.sourceHayCuttingId).filter((v): v is string => !!v)
  );
  const cuttings = new Map<string, ChainCutting>();
  if (cuttingIds.size) {
    for (const c of listAllCuttings()) {
      if (!cuttingIds.has(c.id)) continue;
      cuttings.set(c.id, {
        id: c.id,
        blockId: c.blockId,
        blockName: names.blocks.get(c.blockId) ?? 'a hay block',
        cuttingNumber: c.cuttingNumber,
        cutAtMs: c.mowAt ?? c.createdAt
      });
    }
  }
  const feedUses: ChainFeedUse[] = listHayFeedUses().map((m) => {
    const s = parseFeedUseNote(m.notes);
    return {
      id: m.movementId,
      lotId: m.lotId,
      atMs: m.occurredAt,
      subject: s ? ref(s.type, s.id) : null
    };
  });

  const chains = computeChains({
    batches: batches.map((b) => ({
      id: b.id,
      name: b.name,
      origin: b.origin,
      supplier: b.supplier,
      supplierStatement: b.supplierStatement,
      startedAtMs: b.startedAt,
      closedAtMs: b.closedAt
    })),
    inputs: inputs.map((i) => ({
      id: i.id,
      batchId: i.batchId,
      inputType: i.inputType,
      inputId: i.inputId,
      fromMs: i.fromAt,
      toMs: i.toAt,
      supplierStatement: i.supplierStatement
    })),
    sources,
    feedUses,
    lots,
    cuttings,
    applications,
    fieldNames: names.fields,
    nowMs
  });
  return { chains, batches, inputs, names };
}

/** C-C2 contract. */
export async function loadCarryoverChains(
  nowMs: number = Date.now()
): Promise<Map<string, CarryoverChain>> {
  return (await loadCarryoverData(nowMs)).chains;
}

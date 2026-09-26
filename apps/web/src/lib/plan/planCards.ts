/**
 * Phase 30G: the Cards /plan shows. Pure and client-safe: Area cards for the
 * rail, Block cards for an Area, and the Planting card that replaced the
 * bespoke PlantingCard layout.
 */

import { buildAreaCard } from '$lib/cards/build/area';
import { areaDisplayName, blockDisplayName } from '$lib/cards/build/common';
import { formatSize } from '$lib/cards/build/size';
import {
  cardKey,
  type CardFact,
  type CardModel,
  type CardProvenance,
  type CardStatus
} from '$lib/cards/model';
import type { FarmSnapshot } from '$lib/cards/snapshot';
import type { BlockWithPlantings, PlantingRecord } from '$lib/db/blocks';
import { kindStyle } from '$lib/farm/kindStyle';
import { designerHref } from '$lib/garden/design';
import { isDesignable, type AreaKind } from '$lib/farm/areaKinds';
import { DEFAULT_PREFS, formatCalendarDate, type Prefs } from '$lib/prefs';
import { plantingStatus, type PlantingStatus } from './planV2Derive';

const DAY_MS = 86_400_000;
const PALETTE = [
  '#7a8f5a',
  '#c9961f',
  '#6f8fa8',
  '#a85a1f',
  '#4a8b54',
  '#a23a3a',
  '#8a6722',
  '#7a3a4d'
];
const MAX_NAMES = 2;

/** Stable swatch per planting, shared by the rail, tabs, cards and timeline. */
export function plantingColor(plantingId: string): string {
  let h = 0;
  for (let i = 0; i < plantingId.length; i++) h = (h * 31 + plantingId.charCodeAt(i)) >>> 0;
  return PALETTE[h % PALETTE.length];
}

/** "Tomato · Basil · +2", or null when nothing is planted. */
export function growingSummary(
  plantings: readonly { varietyDisplayName: string }[]
): string | null {
  if (!plantings.length) return null;
  const names = plantings.slice(0, MAX_NAMES).map((p) => p.varietyDisplayName);
  const more = plantings.length - MAX_NAMES;
  return more > 0 ? `${names.join(' · ')} · +${more}` : names.join(' · ');
}

/** The `?field=` value for blocks that sit in no Area. */
export const NO_AREA = 'none';

export function planSelectHref(
  current: URLSearchParams,
  areaId: string,
  blockId?: string | null
): string {
  const sp = new URLSearchParams(current);
  sp.set('field', areaId);
  sp.delete('planting');
  if (blockId) sp.set('block', blockId);
  else sp.delete('block');
  return `/plan?${sp.toString()}`;
}

export interface PlanAreaEntry {
  id: string;
  name: string;
  kind: AreaKind;
}

export interface RailAreaCard {
  areaId: string;
  card: CardModel;
  designer: string | null;
  searchText: string;
}

/** One compact Area card per Area, then one for blocks with no Area. */
export function planRailCards(
  snapshot: FarmSnapshot,
  areas: readonly PlanAreaEntry[],
  blocks: readonly BlockWithPlantings[],
  current: URLSearchParams,
  prefs: Prefs = DEFAULT_PREFS
): RailAreaCard[] {
  const out: RailAreaCard[] = [];
  for (const area of areas) {
    const built = buildAreaCard(snapshot, area.id, { prefs });
    if (!built) continue;
    const inArea = blocks.filter((b) => b.fieldId === area.id);
    out.push(railCard(built, area.id, area.kind, inArea, current));
  }
  const loose = blocks.filter((b) => !b.fieldId || !areas.some((a) => a.id === b.fieldId));
  if (loose.length) {
    const plantings = loose.flatMap((b) => b.plantings);
    const acres = loose.reduce((sum, b) => sum + (b.acres && b.acres > 0 ? b.acres : 0), 0);
    const size = acres > 0 ? formatSize({ acres, widthFt: null, lengthFt: null }, prefs) : null;
    const facts: CardFact[] = [];
    if (size) facts.push({ label: 'Size', value: size, provenance: 'data' });
    facts.push({
      label: 'Growing',
      value: growingSummary(plantings) ?? 'Nothing yet',
      provenance: 'data'
    });
    const card: CardModel = {
      kind: 'area',
      key: 'ar_none',
      kicker: `${loose.length} ${loose.length === 1 ? 'block' : 'blocks'}`,
      title: 'Not in an Area',
      facts,
      sections: [],
      asOf: snapshot.generatedAt,
      provenance: [{ source: 'data' }],
      href: planSelectHref(current, NO_AREA)
    };
    out.push({
      areaId: NO_AREA,
      card,
      designer: null,
      searchText: searchText('Not in an Area', loose)
    });
  }
  return out;
}

function searchText(name: string, blocks: readonly BlockWithPlantings[]): string {
  return [
    name,
    ...blocks.map((b) => b.name),
    ...blocks.flatMap((b) => b.plantings.map((p) => p.varietyDisplayName))
  ]
    .join(' ')
    .toLowerCase();
}

function railCard(
  built: CardModel,
  areaId: string,
  kind: AreaKind,
  blocks: readonly BlockWithPlantings[],
  current: URLSearchParams
): RailAreaCard {
  const size = built.facts.find((f) => f.label === 'Size');
  const growing = growingSummary(blocks.flatMap((b) => b.plantings));
  const facts: CardFact[] = [];
  if (size) facts.push(size);
  facts.push({ label: 'Growing', value: growing ?? 'Nothing yet', provenance: 'data' });
  return {
    areaId,
    card: {
      ...built,
      key: `${built.key}-rail`,
      facts,
      sections: [],
      next: undefined,
      links: undefined,
      bedMap: undefined,
      accent: kindStyle(kind).color,
      href: planSelectHref(current, areaId)
    },
    designer: isDesignable(kind) ? designerHref(areaId) : null,
    searchText: searchText(built.title, blocks)
  };
}

/** The selected Area as a screen card: facts, next task, and for gardens
 *  the bed map with "Open designer". Its block list is the Block cards. */
export function planAreaCard(
  snapshot: FarmSnapshot,
  area: PlanAreaEntry,
  prefs: Prefs = DEFAULT_PREFS
): CardModel | null {
  const built = buildAreaCard(snapshot, area.id, { prefs });
  if (!built) return null;
  return {
    ...built,
    title: areaDisplayName({ name: area.name, kind: area.kind }),
    sections: built.sections.filter((s) => s.title === 'Notes'),
    accent: kindStyle(area.kind).color
  };
}

const STATUS_TONE: Record<PlantingStatus, CardStatus['tone']> = {
  planned: 'sky',
  active: 'forest',
  mature: 'wheat'
};

export function planBlockCard(
  block: BlockWithPlantings,
  current: URLSearchParams,
  areaId: string,
  cropDays: Record<string, number | undefined>,
  prefs: Prefs = DEFAULT_PREFS,
  now: number = Date.now()
): CardModel {
  const facts: CardFact[] = [];
  const size = formatSize(
    {
      acres: block.acres ?? null,
      widthFt: block.widthFt ?? null,
      lengthFt: block.lengthFt ?? null
    },
    prefs
  );
  if (size) facts.push({ label: 'Size', value: size, provenance: 'data' });
  facts.push({
    label: 'Growing',
    value: growingSummary(block.plantings) ?? 'Nothing yet',
    provenance: 'data'
  });
  const statuses = block.plantings.map((p) =>
    plantingStatus(p.plantingDate, cropDays[p.cropPluginId], now)
  );
  const status: CardStatus | undefined = statuses.includes('active')
    ? { label: 'active', tone: 'forest' }
    : statuses.length && statuses.every((s) => s === 'mature')
      ? { label: 'mature', tone: 'wheat' }
      : statuses.length
        ? { label: 'planned', tone: 'sky' }
        : undefined;
  return {
    kind: 'area',
    key: `bk_${block.id}`,
    kicker: block.plantings.length === 1 ? '1 planting' : `${block.plantings.length} plantings`,
    title: blockDisplayName({
      name: block.name,
      kind: block.kind ?? 'block',
      blockLabel: block.blockLabel ?? null
    }),
    facts,
    sections: [],
    asOf: now,
    provenance: [{ source: 'data' }],
    href: planSelectHref(current, areaId, block.id),
    accent: block.plantings[0] ? plantingColor(block.plantings[0].id) : undefined,
    ...(status ? { status } : {})
  };
}

export type PlantingSourceTag =
  'AI plan' | 'Companion AI' | 'Carry-forward' | 'Manual' | 'Perennial';

const SOURCE_PROVENANCE: Record<PlantingSourceTag, CardProvenance['source']> = {
  'AI plan': 'ai',
  'Companion AI': 'ai',
  'Carry-forward': 'fallback',
  Manual: 'manual',
  Perennial: 'plugin'
};

export interface PlanPlantingCardInput {
  planting: PlantingRecord;
  daysToMaturity?: number;
  cropName?: string;
  stage?: string;
  harvestStart?: string;
  role?: string;
  sourceTag?: PlantingSourceTag;
  refineCount?: number;
  seededAtLabel?: string;
  detailHref?: string;
  now?: number;
}

export const NO_VALUE = '—';

/** The /plan Planting card: status, role, stage, planted, harvest, amount. */
export function planPlantingCard(input: PlanPlantingCardInput): CardModel {
  const { planting } = input;
  const status = plantingStatus(planting.plantingDate, input.daysToMaturity, input.now);
  const planted =
    planting.plantingDate == null ? 'planned' : formatCalendarDate(planting.plantingDate, 'date');
  let harvest = input.harvestStart;
  if (!harvest) {
    harvest =
      planting.plantingDate != null && input.daysToMaturity
        ? formatCalendarDate(planting.plantingDate + input.daysToMaturity * DAY_MS, 'month-day')
        : NO_VALUE;
  }
  const amount =
    planting.quantityPlanted !== undefined && planting.quantityUnit
      ? `${planting.quantityPlanted} ${planting.quantityUnit}`
      : NO_VALUE;
  const sub = [
    input.cropName && input.cropName !== planting.varietyDisplayName ? input.cropName : undefined,
    input.role
  ]
    .filter(Boolean)
    .join(' · ');

  const detail = input.sourceTag
    ? [
        input.sourceTag,
        input.seededAtLabel,
        input.refineCount ? `refined ${input.refineCount}×` : undefined
      ]
        .filter(Boolean)
        .join(' · ')
    : 'Manual entry';
  const provenance: CardProvenance[] = [
    {
      source: input.sourceTag ? SOURCE_PROVENANCE[input.sourceTag] : 'manual',
      detail
    }
  ];
  return {
    kind: 'planting',
    key: cardKey('planting', planting.id),
    kicker: sub || 'Planting',
    title: planting.varietyDisplayName,
    status: { label: status, tone: STATUS_TONE[status] },
    facts: [
      { label: 'Role', value: input.role ?? NO_VALUE },
      { label: 'Stage', value: input.stage ?? NO_VALUE },
      { label: 'Planted', value: planted },
      { label: 'Harvest', value: harvest },
      { label: 'Amount', value: amount }
    ],
    sections: [],
    asOf: input.now ?? Date.now(),
    provenance,
    href: `/crops/${encodeURIComponent(planting.id)}`,
    accent: plantingColor(planting.id),
    ...(input.detailHref
      ? { links: [{ label: 'Stages, scab risk & vernalization', href: input.detailHref }] }
      : {})
  };
}

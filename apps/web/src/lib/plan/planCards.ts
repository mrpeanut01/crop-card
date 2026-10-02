/**
 * Phase 30G: the Cards /plan shows. Pure and client-safe: Area cards for the
 * rail, Block cards for an Area, and the Planting card that replaced the
 * bespoke PlantingCard layout.
 */

import { buildAreaCard } from '$lib/cards/build/area';
import { areaDisplayName, blockDisplayName } from '$lib/cards/build/common';
import { formatSize } from '$lib/cards/build/size';
import {
  PLANTING_JOURNAL_LINK_LABEL,
  cardKey,
  plantingCardHref,
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
import { quantityUnitLabel } from './cropPicker';
import { t } from '$lib/i18n';
import { cropDisplayName } from '$lib/i18n/cropName';
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
  plantings: readonly { varietyDisplayName: string; cropPluginId?: string }[],
  locale?: string | null
): string | null {
  if (!plantings.length) return null;
  const names = plantings
    .slice(0, MAX_NAMES)
    .map((p) => cropDisplayName(p.cropPluginId, p.varietyDisplayName, locale));
  const more = plantings.length - MAX_NAMES;
  return more > 0 ? `${names.join(' · ')} · +${more}` : names.join(' · ');
}

/** "Growing" for what is in the ground and "Planned" for what is not yet
 *  sown, so the rail and block cards agree with the Area card. */
export function growingFacts(
  plantings: readonly {
    varietyDisplayName: string;
    cropPluginId?: string;
    plantingDate: number | null;
  }[],
  now: number = Date.now(),
  locale?: string | null
): CardFact[] {
  const planned = plantings.filter(
    (p) => plantingStatus(p.plantingDate, undefined, now) === 'planned'
  );
  const growing = plantings.filter((p) => !planned.includes(p));
  const facts: CardFact[] = [
    {
      label: t(locale, 'plantui.card.growing'),
      value: growingSummary(growing, locale) ?? t(locale, 'plantui.card.nothingYet'),
      provenance: 'data'
    }
  ];
  if (planned.length) {
    facts.push({
      label: t(locale, 'plantui.card.planned'),
      value: growingSummary(planned, locale)!,
      provenance: 'data'
    });
  }
  return facts;
}

function blockAcres(b: {
  acres?: number | null;
  widthFt?: number | null;
  lengthFt?: number | null;
}): number {
  if (b.widthFt && b.widthFt > 0 && b.lengthFt && b.lengthFt > 0) {
    return (b.widthFt * b.lengthFt) / 43_560;
  }
  return b.acres && b.acres > 0 ? b.acres : 0;
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
  prefs: Prefs = DEFAULT_PREFS,
  now: number = Date.now()
): RailAreaCard[] {
  const locale = prefs.locale;
  const out: RailAreaCard[] = [];
  for (const area of areas) {
    const built = buildAreaCard(snapshot, area.id, { prefs });
    if (!built) continue;
    const inArea = blocks.filter((b) => b.fieldId === area.id);
    out.push(railCard(built, area.id, area.kind, inArea, current, now, prefs.locale));
  }
  const loose = blocks.filter((b) => !b.fieldId || !areas.some((a) => a.id === b.fieldId));
  if (loose.length) {
    const plantings = loose.flatMap((b) => b.plantings);
    const acres = loose.reduce((sum, b) => sum + blockAcres(b), 0);
    const size = acres > 0 ? formatSize({ acres, widthFt: null, lengthFt: null }, prefs) : null;
    const facts: CardFact[] = [];
    if (size)
      facts.push({ label: t(locale, 'plantui.card.size'), value: size, provenance: 'data' });
    facts.push(...growingFacts(plantings, now, locale));
    const notInArea = t(locale, 'plantui.card.notInArea');
    const card: CardModel = {
      kind: 'area',
      key: 'ar_none',
      kicker: t(locale, 'plantui.card.blocks', { count: loose.length }),
      title: notInArea,
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
      searchText: searchText(notInArea, loose, prefs.locale)
    });
  }
  return out;
}

function searchText(
  name: string,
  blocks: readonly BlockWithPlantings[],
  locale?: string | null
): string {
  return [
    name,
    ...blocks.map((b) => b.name),
    ...blocks.flatMap((b) => b.plantings.map((p) => p.varietyDisplayName)),
    ...blocks.flatMap((b) =>
      b.plantings
        .map((p) => cropDisplayName(p.cropPluginId, p.varietyDisplayName, locale))
        .filter((n, i) => n !== b.plantings[i].varietyDisplayName)
    )
  ]
    .join(' ')
    .toLowerCase();
}

function railCard(
  built: CardModel,
  areaId: string,
  kind: AreaKind,
  blocks: readonly BlockWithPlantings[],
  current: URLSearchParams,
  now: number,
  locale?: string | null
): RailAreaCard {
  const sizeLabel = t(locale, 'plantui.card.size');
  const size = built.facts.find((f) => f.label === 'Size' || f.label === sizeLabel);
  const facts: CardFact[] = [];
  if (size) facts.push(size);
  facts.push(
    ...growingFacts(
      blocks.flatMap((b) => b.plantings),
      now,
      locale
    )
  );
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
    searchText: searchText(built.title, blocks, locale)
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
  const notesTitle = t(prefs.locale, 'plantui.card.notes');
  return {
    ...built,
    title: areaDisplayName({ name: area.name, kind: area.kind }),
    sections: built.sections.filter((s) => s.title === 'Notes' || s.title === notesTitle),
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
  const locale = prefs.locale;
  if (size) facts.push({ label: t(locale, 'plantui.card.size'), value: size, provenance: 'data' });
  facts.push(...growingFacts(block.plantings, now, locale));
  const statuses = block.plantings.map((p) =>
    plantingStatus(p.plantingDate, cropDays[p.cropPluginId], now)
  );
  const status: CardStatus | undefined = statuses.includes('active')
    ? { label: t(locale, 'plantui.status.active'), tone: 'forest' }
    : statuses.length && statuses.every((s) => s === 'mature')
      ? { label: t(locale, 'plantui.status.mature'), tone: 'wheat' }
      : statuses.length
        ? { label: t(locale, 'plantui.status.planned'), tone: 'sky' }
        : undefined;
  return {
    kind: 'area',
    key: `bk_${block.id}`,
    kicker: t(locale, 'plantui.card.plantings', { count: block.plantings.length }),
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
  locale?: string | null;
}

export const NO_VALUE = '—';

const SOURCE_TAG_KEY = {
  'AI plan': 'plantui.source.aiPlan',
  'Companion AI': 'plantui.source.companionAi',
  'Carry-forward': 'plantui.source.carryForward',
  Manual: 'plantui.source.manual',
  Perennial: 'plantui.source.perennial'
} as const satisfies Record<PlantingSourceTag, string>;

export function sourceTagLabel(tag: PlantingSourceTag, locale?: string | null): string {
  return t(locale, SOURCE_TAG_KEY[tag]);
}

/** The /plan Planting card: status, role, stage, planted, harvest, amount. */
export function planPlantingCard(input: PlanPlantingCardInput): CardModel {
  const { planting, locale } = input;
  const status = plantingStatus(planting.plantingDate, input.daysToMaturity, input.now);
  const planted =
    planting.plantingDate == null
      ? t(locale, 'plantui.status.planned')
      : formatCalendarDate(planting.plantingDate, 'date', {}, locale);
  let harvest = input.harvestStart;
  if (!harvest) {
    harvest =
      planting.plantingDate != null && input.daysToMaturity
        ? formatCalendarDate(
            planting.plantingDate + input.daysToMaturity * DAY_MS,
            'month-day',
            {},
            locale
          )
        : NO_VALUE;
  }
  const amount =
    planting.quantityPlanted !== undefined && planting.quantityUnit
      ? `${planting.quantityPlanted} ${quantityUnitLabel(planting.quantityUnit, locale)}`
      : NO_VALUE;
  const sub = [
    input.cropName && input.cropName !== planting.varietyDisplayName
      ? cropDisplayName(planting.cropPluginId, input.cropName, input.locale)
      : undefined,
    input.role
  ]
    .filter(Boolean)
    .join(' · ');

  const detail = input.sourceTag
    ? [
        sourceTagLabel(input.sourceTag, locale),
        input.seededAtLabel,
        input.refineCount ? t(locale, 'plantui.card.refined', { n: input.refineCount }) : undefined
      ]
        .filter(Boolean)
        .join(' · ')
    : t(locale, 'plantui.card.manualEntry');
  const provenance: CardProvenance[] = [
    {
      source: input.sourceTag ? SOURCE_PROVENANCE[input.sourceTag] : 'manual',
      detail
    }
  ];
  return {
    kind: 'planting',
    key: cardKey('planting', planting.id),
    kicker: sub || t(locale, 'plantui.card.planting'),
    title: cropDisplayName(planting.cropPluginId, planting.varietyDisplayName, locale),
    status: { label: t(locale, `plantui.status.${status}`), tone: STATUS_TONE[status] },
    facts: [
      { label: t(locale, 'plantui.card.role'), value: input.role ?? NO_VALUE },
      { label: t(locale, 'plantui.card.stage'), value: input.stage ?? NO_VALUE },
      { label: t(locale, 'plantui.card.planted'), value: planted },
      { label: t(locale, 'plantui.card.harvest'), value: harvest },
      { label: t(locale, 'plantui.card.amount'), value: amount }
    ],
    sections: [],
    asOf: input.now ?? Date.now(),
    provenance,
    href: `/crops/${encodeURIComponent(planting.id)}`,
    accent: plantingColor(planting.id),
    links: [
      ...(input.detailHref
        ? [{ label: t(locale, 'plantui.card.smallGrainLink'), href: input.detailHref }]
        : []),
      {
        label: locale ? t(locale, 'plantui.card.journalLink') : PLANTING_JOURNAL_LINK_LABEL,
        href: plantingCardHref(planting.id)
      }
    ]
  };
}

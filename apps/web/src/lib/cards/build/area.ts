import {
  cardHref,
  cardKey,
  mergeProvenance,
  type CardFact,
  type CardModel,
  type CardProvenance,
  type CardSection
} from '../model';
import type {
  FarmSnapshot,
  SnapshotArea,
  SnapshotBlock,
  SnapshotBlockKind,
  SnapshotPlanting
} from '../snapshot';
import {
  CROP_AREA_KINDS,
  areaDisplayName,
  areaKindLabel,
  blockDisplayName,
  monthDay,
  nextAction,
  resolveOptions,
  sortTasks,
  type BuildOptions,
  type ResolvedOptions,
  plantingName
} from './common';
import { SQFT_PER_ACRE, formatAreaAcres, formatFeet, formatSize, sizeBasis } from './size';
import { areaCareLinks } from './careGuide';
import { DEFAULT_AREA_KIND, isDesignable } from '$lib/farm/areaKinds';
import { watererNamesFor } from '$lib/farm/mapFeatures';
import { designFromSnapshot, designerHref } from '$lib/garden/design';
import { bedOccupancyOn, occupancyIntervals, scrubRange, utcDayStart } from '$lib/garden/occupancy';
import type { CardBedMap, CardBedMapPlanting } from '../model';
import { displayFootprints } from '$lib/garden/displayPack';
import { familyGlyph } from '$lib/garden/familyGlyph';
import { footprintBounds } from '$lib/garden/geometry';
import { withSnapshotAnimals } from './areaAnimals';
import { AREA_LINE_LIMIT, withCarryover, type CarryoverLine } from '$lib/farm/areaCarryover';

const MAX_LIST = 8;
const BLOCK_KIND_ORDER: SnapshotBlockKind[] = ['bed', 'row', 'container', 'block'];

const KIND_COUNT = {
  bed: 'cards.area.count.bed',
  row: 'cards.area.count.row',
  container: 'cards.area.count.container',
  block: 'cards.area.count.block'
} as const satisfies Record<SnapshotBlockKind, string>;

const KIND_SECTION = {
  bed: 'cards.area.section.bed',
  row: 'cards.area.section.row',
  container: 'cards.area.section.container',
  block: 'cards.area.section.block'
} as const satisfies Record<SnapshotBlockKind, string>;

function capped(items: string[], opts: ResolvedOptions): string[] {
  if (items.length <= MAX_LIST) return items;
  return [...items.slice(0, MAX_LIST), opts.tr('cards.more', { count: items.length - MAX_LIST })];
}

/** Sketch dimensions and typed acres are the owner's; only acres measured
 *  from drawn map geometry are `data`. */
function sizeProvenance(area: SnapshotArea, opts: ResolvedOptions): CardProvenance | null {
  const { tr } = opts;
  const basis = sizeBasis(area);
  if (basis === 'dimensions') return { source: 'manual', detail: tr('cards.prov.yourDimensions') };
  if (basis !== 'acres' || area.acresSource === null) return null;
  if (area.acresSource === 'geometry') return { source: 'data', detail: tr('cards.prov.yourMap') };
  return {
    source: 'manual',
    detail:
      area.acresSource === 'typed' ? tr('cards.prov.typedAcres') : tr('cards.prov.yourDimensions')
  };
}

function plantingLine(
  p: SnapshotPlanting,
  block: SnapshotBlock | undefined,
  showDate: boolean,
  locale?: string | null
): string {
  const where = block ? ` · ${blockDisplayName(block, locale)}` : '';
  const when = showDate && p.plantingDate ? ` · ${monthDay(p.plantingDate, locale)}` : '';
  return `${plantingName(p, locale)}${where}${when}`;
}

/** A bed's own width by length when it has them; stored acres are rounded
 *  to 0.001 and would overstate small beds. */
function blockSizeAcres(b: {
  acres: number | null;
  widthFt: number | null;
  lengthFt: number | null;
}): number {
  if (b.widthFt && b.widthFt > 0 && b.lengthFt && b.lengthFt > 0) {
    return (b.widthFt * b.lengthFt) / SQFT_PER_ACRE;
  }
  return typeof b.acres === 'number' && b.acres > 0 ? b.acres : 0;
}

/** The Area Card; on an offline bundle it also lists who lives there and
 *  the Area's grazing holds (32D). Live pages add those themselves. */
export function buildAreaCard(
  snapshot: FarmSnapshot,
  areaId: string,
  options: BuildOptions = {}
): CardModel | null {
  const card = baseAreaCard(snapshot, areaId, options);
  if (!card) return null;
  const resolved = resolveOptions(snapshot, options);
  return withSnapshotCarryover(
    snapshot,
    areaId,
    withSnapshotAnimals(snapshot, areaId, card, resolved),
    { locale: resolved.prefs.locale }
  );
}

/** The 33C after-spread lines a snapshot carries for the blocks on an
 *  Area (M-52), with the blocks' names. */
export function snapshotCarryoverLines(
  snapshot: FarmSnapshot,
  blockIds: readonly string[]
): CarryoverLine[] {
  if (!snapshot.carryover?.length) return [];
  const ids = new Set(blockIds);
  return snapshot.carryover
    .filter((l) => ids.has(l.blockId))
    .map((l) => ({
      blockId: l.blockId,
      applicationId: '',
      batchId: '',
      tone: l.tone,
      text: l.text,
      provenance: 'data' as const
    }));
}

/** The Area Card with its blocks' carryover lines, at most three, each
 *  named by its block. Live pages pass `link` for the test and dismiss
 *  page; the offline card has no such page. */
export function withSnapshotCarryover(
  snapshot: FarmSnapshot,
  areaId: string,
  card: CardModel,
  opts: { link?: boolean; locale?: string | null } = {}
): CardModel {
  const blocks = snapshot.blocks.filter((b) => b.areaId === areaId);
  const lines = snapshotCarryoverLines(
    snapshot,
    blocks.map((b) => b.id)
  );
  const names = new Map(blocks.map((b) => [b.id, blockDisplayName(b)]));
  return withCarryover(card, lines, {
    blockNames: names,
    max: AREA_LINE_LIMIT,
    link: opts.link,
    locale: opts.locale
  });
}

function baseAreaCard(
  snapshot: FarmSnapshot,
  areaId: string,
  options: BuildOptions
): CardModel | null {
  const area = snapshot.areas.find((a) => a.id === areaId);
  if (!area) return null;
  const opts = resolveOptions(snapshot, options);
  const { tr } = opts;
  const loc = opts.prefs.locale;
  const kindLabel = areaKindLabel(area.kind, loc);
  const size = formatSize(area, opts.prefs);
  const cropBearing = CROP_AREA_KINDS.has(area.kind);

  const blocks = snapshot.blocks
    .filter((b) => b.areaId === area.id)
    .sort((a, b) =>
      blockDisplayName(a).localeCompare(blockDisplayName(b), 'en', { numeric: true })
    );
  const blockById = new Map(blocks.map((b) => [b.id, b]));
  const plantings = snapshot.plantings.filter((p) => blockById.has(p.blockId));
  const active = plantings.filter((p) => p.status === 'active');
  const planned = plantings.filter((p) => p.status === 'planned');
  const plantingIds = new Set(plantings.map((p) => p.id));

  const facts: CardFact[] = [];
  // Migration 0050 and a create without a kind both default to `field`, so
  // only a non-default kind is known to be the owner's pick.
  const provenance: CardProvenance[] =
    area.kind !== DEFAULT_AREA_KIND
      ? [{ source: 'manual', detail: tr('cards.prov.kindPicked') }]
      : [];
  if (size) {
    const sp = sizeProvenance(area, opts);
    facts.push({ label: tr('cards.fact.size'), value: size, provenance: sp?.source });
    if (sp) provenance.push(sp);
  }
  if (!size) {
    const blockAcres = blocks.reduce((sum, b) => sum + blockSizeAcres(b), 0);
    if (blockAcres > 0) {
      facts.push({
        label: tr('cards.fact.size'),
        value: tr('cards.area.sizeAcross', {
          count: blocks.length,
          size: formatAreaAcres(blockAcres, opts.prefs)
        }),
        provenance: 'data'
      });
    }
  }
  if (area.perimeterFt !== null && area.perimeterFt > 0) {
    facts.push({
      label: tr('cards.fact.perimeter'),
      value: formatFeet(area.perimeterFt, opts.prefs),
      provenance: 'data'
    });
  }

  if (blocks.length) {
    const counts = new Map<SnapshotBlockKind, number>();
    for (const b of blocks) counts.set(b.kind, (counts.get(b.kind) ?? 0) + 1);
    const value = BLOCK_KIND_ORDER.filter((k) => counts.has(k))
      .map((k) => tr(KIND_COUNT[k], { count: counts.get(k)! }))
      .join(' · ');
    facts.push({ label: tr('cards.fact.holds'), value, provenance: 'data' });
  }

  if (cropBearing) {
    facts.push({
      label: tr('cards.fact.growing'),
      value: active.length
        ? tr('cards.area.plantings', { count: active.length })
        : tr('cards.area.nothingYet'),
      provenance: 'data'
    });
    if (planned.length) {
      facts.push({ label: tr('cards.fact.planned'), value: `${planned.length}`, provenance: 'data' });
    }
  }
  if (area.organicStatus) {
    facts.push({
      label: tr('cards.fact.organicStatus'),
      value: area.organicStatus,
      provenance: 'manual'
    });
    provenance.push({ source: 'manual', detail: tr('cards.prov.organicEntered') });
  }
  const water = watererNamesFor(area.id, snapshot.mapFeatures ?? []);
  if (water.length) {
    facts.push({ label: tr('cards.fact.water'), value: water.join(', '), provenance: 'manual' });
    provenance.push({ source: 'manual', detail: tr('cards.prov.hydrants') });
  }
  if (facts.some((f) => f.provenance === 'data')) provenance.push({ source: 'data' });

  const sections: CardSection[] = [];
  if (active.length) {
    sections.push({
      title: tr('cards.area.growingNow'),
      items: capped(
        active.map((p) => plantingLine(p, blockById.get(p.blockId), false, loc)),
        opts
      )
    });
  }
  if (planned.length) {
    sections.push({
      title: tr('cards.fact.planned'),
      items: capped(
        planned.map((p) => plantingLine(p, blockById.get(p.blockId), true, loc)),
        opts
      )
    });
  }
  for (const kind of BLOCK_KIND_ORDER) {
    if (kind === 'block') continue;
    const ofKind = blocks.filter((b) => b.kind === kind);
    if (!ofKind.length) continue;
    sections.push({
      title: tr(KIND_SECTION[kind]),
      items: capped(
        ofKind.map((b) => {
          const s = formatSize(b, opts.prefs);
          return s ? `${blockDisplayName(b, loc)} · ${s}` : blockDisplayName(b, loc);
        }),
        opts
      )
    });
  }
  if (area.kind === 'greenhouse' && active.length) {
    sections.push({ title: tr('cards.area.watering'), items: [tr('advice.water.greenhouse')] });
  }
  if (area.notes?.trim()) sections.push({ title: tr('cards.notes'), items: [area.notes.trim()] });

  const tasks = sortTasks(
    snapshot.tasks.filter(
      (t) =>
        (t.blockId !== null && blockById.has(t.blockId)) ||
        (t.cropId !== null && plantingIds.has(t.cropId))
    )
  );

  const name = areaDisplayName(area, loc);
  const kicker = size ? `${kindLabel} · ${size}` : kindLabel;
  const key = cardKey('area', area.id);
  const bedMap = isDesignable(area.kind)
    ? buildBedMap(snapshot, area.id, options.bedMapOnMs ?? opts.now, loc)
    : null;

  return {
    ...(isDesignable(area.kind)
      ? {
          links: [
            { label: tr('cards.area.openDesigner'), href: designerHref(area.id) },
            ...areaCareLinks(snapshot, area.id, loc)
          ]
        }
      : {}),
    ...(bedMap ? { bedMap } : {}),
    kind: 'area',
    key,
    kicker,
    title: name,
    facts,
    next: nextAction(tasks, opts, snapshot.plantings),
    sections,
    asOf: snapshot.generatedAt,
    provenance: mergeProvenance(provenance),
    href: cardHref('area', key)
  };
}

/** To-scale bed sketch for a garden or greenhouse, with what is in each bed
 *  on `onMs`. Null when the Area has no beds or containers. */
export function buildBedMap(
  snapshot: FarmSnapshot,
  areaId: string,
  onMs: number,
  loc?: string | null
): CardBedMap | null {
  const design = designFromSnapshot(snapshot, areaId, {
    seasonYear: new Date(onMs).getUTCFullYear(),
    readOnlyReason: null
  });
  if (!design || design.beds.length === 0) return null;
  const intervals = occupancyIntervals(design.plantings, design.crops, {
    firstFallFrostMs: design.frost.firstFallFrostMs,
    lastSpringFrostMs: design.frost.lastSpringFrostMs
  });
  const range = scrubRange(design.seasonYear, intervals, onMs, design.frost);
  const byId = new Map(design.plantings.map((p) => [p.cropId, p]));
  const day = utcDayStart(onMs);
  const ivById = new Map(intervals.map((i) => [i.cropId, i]));
  const display = displayFootprints(design.beds, design.plantings, intervals, design.crops);
  return {
    widthFt: design.canvas.widthFt,
    lengthFt: design.canvas.lengthFt,
    hasNorth: design.canvas.hasNorth,
    onMs: day,
    beds: design.beds.map((b) => ({
      name: b.name,
      kind: b.kind,
      x: b.rect.x,
      y: b.rect.y,
      w: b.rect.w,
      l: b.rect.l,
      crops: bedOccupancyOn(b, intervals, day, range)
        .occupants.map((o) => {
          const hit = byId.get(o.cropId);
          return hit ? plantingName(hit, loc) : undefined;
        })
        .filter((n): n is string => !!n),
      plantings: design.plantings
        .filter((p) => p.blockId === b.blockId)
        .flatMap((p): CardBedMapPlanting[] => {
          const iv = ivById.get(p.cropId);
          if (!iv) return [];
          const now = day >= iv.startMs && day < iv.endMs;
          const later = !now && iv.startMs > day && iv.startMs <= range.endMs;
          const fp = p.footprint ?? display.get(p.cropId);
          if ((!now && !later) || !fp) return [];
          const r = footprintBounds(fp, b);
          return [
            {
              name: (() => {
                const shown = plantingName(p, loc);
                return shown.split(/[—(]/)[0].trim() || shown;
              })(),
              glyph: familyGlyph(p.cropFamily).key,
              x: r.x,
              y: r.y,
              w: r.w,
              l: r.l,
              placed: !!p.footprint,
              later,
              from: later ? new Date(iv.startMs).toISOString().slice(0, 10) : null
            }
          ];
        })
        .sort((a, c) => Number(c.later) - Number(a.later) || a.x - c.x || a.y - c.y)
    }))
  };
}

export function buildAreaCards(snapshot: FarmSnapshot, options: BuildOptions = {}): CardModel[] {
  return snapshot.areas
    .map((a) => buildAreaCard(snapshot, a.id, options))
    .filter((c): c is CardModel => c !== null);
}

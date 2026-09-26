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
  BLOCK_KIND_LABEL,
  CROP_AREA_KINDS,
  areaDisplayName,
  areaKindLabel,
  blockDisplayName,
  monthDay,
  nextAction,
  resolveOptions,
  sortTasks,
  type BuildOptions
} from './common';
import { formatAreaAcres, formatFeet, formatSize, sizeBasis } from './size';
import { DEFAULT_AREA_KIND, isDesignable } from '$lib/farm/areaKinds';
import { designFromSnapshot, designerHref } from '$lib/garden/design';
import { bedOccupancyOn, occupancyIntervals, scrubRange, utcDayStart } from '$lib/garden/occupancy';
import type { CardBedMap } from '../model';

const MAX_LIST = 8;
const BLOCK_KIND_ORDER: SnapshotBlockKind[] = ['bed', 'row', 'container', 'block'];

function plural(n: number, word: string): string {
  return `${n} ${word.toLowerCase()}${n === 1 ? '' : 's'}`;
}

function capped(items: string[]): string[] {
  if (items.length <= MAX_LIST) return items;
  return [...items.slice(0, MAX_LIST), `+${items.length - MAX_LIST} more`];
}

/** Sketch dimensions and typed acres are the owner's; only acres measured
 *  from drawn map geometry are `data`. */
function sizeProvenance(area: SnapshotArea): CardProvenance | null {
  const basis = sizeBasis(area);
  if (basis === 'dimensions') return { source: 'manual', detail: 'your dimensions' };
  if (basis !== 'acres' || area.acresSource === null) return null;
  if (area.acresSource === 'geometry') return { source: 'data', detail: 'your map' };
  return {
    source: 'manual',
    detail: area.acresSource === 'typed' ? 'typed acres' : 'your dimensions'
  };
}

function plantingLine(
  p: SnapshotPlanting,
  block: SnapshotBlock | undefined,
  showDate: boolean
): string {
  const where = block ? ` · ${blockDisplayName(block)}` : '';
  const when = showDate && p.plantingDate ? ` · ${monthDay(p.plantingDate)}` : '';
  return `${p.varietyDisplayName}${where}${when}`;
}

export function buildAreaCard(
  snapshot: FarmSnapshot,
  areaId: string,
  options: BuildOptions = {}
): CardModel | null {
  const area = snapshot.areas.find((a) => a.id === areaId);
  if (!area) return null;
  const opts = resolveOptions(snapshot, options);
  const kindLabel = areaKindLabel(area.kind);
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
    area.kind !== DEFAULT_AREA_KIND ? [{ source: 'manual', detail: 'kind picked by you' }] : [];
  if (size) {
    const sp = sizeProvenance(area);
    facts.push({ label: 'Size', value: size, provenance: sp?.source });
    if (sp) provenance.push(sp);
  }
  if (!size) {
    const blockAcres = blocks.reduce(
      (sum, b) => sum + (typeof b.acres === 'number' && b.acres > 0 ? b.acres : 0),
      0
    );
    if (blockAcres > 0) {
      facts.push({
        label: 'Size',
        value: `${formatAreaAcres(blockAcres, opts.prefs)} across its ${blocks.length === 1 ? 'bed' : 'beds'}`,
        provenance: 'data'
      });
    }
  }
  if (area.perimeterFt !== null && area.perimeterFt > 0) {
    facts.push({
      label: 'Perimeter',
      value: formatFeet(area.perimeterFt, opts.prefs),
      provenance: 'data'
    });
  }

  if (blocks.length) {
    const counts = new Map<SnapshotBlockKind, number>();
    for (const b of blocks) counts.set(b.kind, (counts.get(b.kind) ?? 0) + 1);
    const value = BLOCK_KIND_ORDER.filter((k) => counts.has(k))
      .map((k) => plural(counts.get(k)!, BLOCK_KIND_LABEL[k]))
      .join(' · ');
    facts.push({ label: 'Holds', value, provenance: 'data' });
  }

  if (cropBearing) {
    facts.push({
      label: 'Growing',
      value: active.length
        ? `${active.length} planting${active.length === 1 ? '' : 's'}`
        : 'Nothing yet',
      provenance: 'data'
    });
    if (planned.length) {
      facts.push({ label: 'Planned', value: `${planned.length}`, provenance: 'data' });
    }
  }
  if (facts.some((f) => f.provenance === 'data')) provenance.push({ source: 'data' });

  const sections: CardSection[] = [];
  if (active.length) {
    sections.push({
      title: 'Growing now',
      items: capped(active.map((p) => plantingLine(p, blockById.get(p.blockId), false)))
    });
  }
  if (planned.length) {
    sections.push({
      title: 'Planned',
      items: capped(planned.map((p) => plantingLine(p, blockById.get(p.blockId), true)))
    });
  }
  for (const kind of BLOCK_KIND_ORDER) {
    if (kind === 'block') continue;
    const ofKind = blocks.filter((b) => b.kind === kind);
    if (!ofKind.length) continue;
    sections.push({
      title: `${BLOCK_KIND_LABEL[kind]}s`,
      items: capped(
        ofKind.map((b) => {
          const s = formatSize(b, opts.prefs);
          return s ? `${blockDisplayName(b)} · ${s}` : blockDisplayName(b);
        })
      )
    });
  }
  if (area.notes?.trim()) sections.push({ title: 'Notes', items: [area.notes.trim()] });

  const tasks = sortTasks(
    snapshot.tasks.filter(
      (t) =>
        (t.blockId !== null && blockById.has(t.blockId)) ||
        (t.cropId !== null && plantingIds.has(t.cropId))
    )
  );

  const name = areaDisplayName(area);
  const kicker = size ? `${kindLabel} · ${size}` : kindLabel;
  const key = cardKey('area', area.id);
  const bedMap = isDesignable(area.kind) ? buildBedMap(snapshot, area.id, options.bedMapOnMs ?? opts.now) : null;

  return {
    ...(isDesignable(area.kind)
      ? { links: [{ label: 'Open designer', href: designerHref(area.id) }] }
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
export function buildBedMap(snapshot: FarmSnapshot, areaId: string, onMs: number): CardBedMap | null {
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
  return {
    widthFt: design.canvas.widthFt,
    lengthFt: design.canvas.lengthFt,
    hasNorth: design.canvas.hasNorth,
    onMs: utcDayStart(onMs),
    beds: design.beds.map((b) => ({
      name: b.name,
      kind: b.kind,
      x: b.rect.x,
      y: b.rect.y,
      w: b.rect.w,
      l: b.rect.l,
      crops: bedOccupancyOn(b, intervals, utcDayStart(onMs), range)
        .occupants.map((o) => byId.get(o.cropId)?.varietyDisplayName)
        .filter((n): n is string => !!n)
    }))
  };
}

export function buildAreaCards(snapshot: FarmSnapshot, options: BuildOptions = {}): CardModel[] {
  return snapshot.areas
    .map((a) => buildAreaCard(snapshot, a.id, options))
    .filter((c): c is CardModel => c !== null);
}

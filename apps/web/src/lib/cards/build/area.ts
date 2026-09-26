import {
  cardHref,
  cardKey,
  mergeProvenance,
  type CardFact,
  type CardModel,
  type CardProvenance,
  type CardSection
} from '../model';
import type { FarmSnapshot, SnapshotBlock, SnapshotBlockKind, SnapshotPlanting } from '../snapshot';
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
import { formatFeet, formatSize } from './size';

const MAX_LIST = 8;
const BLOCK_KIND_ORDER: SnapshotBlockKind[] = ['bed', 'row', 'container', 'block'];

function plural(n: number, word: string): string {
  return `${n} ${word.toLowerCase()}${n === 1 ? '' : 's'}`;
}

function capped(items: string[]): string[] {
  if (items.length <= MAX_LIST) return items;
  return [...items.slice(0, MAX_LIST), `+${items.length - MAX_LIST} more`];
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
    .sort((a, b) => blockDisplayName(a).localeCompare(blockDisplayName(b), 'en', { numeric: true }));
  const blockById = new Map(blocks.map((b) => [b.id, b]));
  const plantings = snapshot.plantings.filter((p) => blockById.has(p.blockId));
  const active = plantings.filter((p) => p.status === 'active');
  const planned = plantings.filter((p) => p.status === 'planned');
  const plantingIds = new Set(plantings.map((p) => p.id));

  const facts: CardFact[] = [];
  const provenance: CardProvenance[] = [{ source: 'manual', detail: 'kind picked by you' }];
  if (size) {
    const drawn = area.widthFt !== null && area.lengthFt !== null;
    facts.push({ label: 'Size', value: size, provenance: drawn ? 'manual' : 'data' });
    provenance.push(drawn ? { source: 'manual' } : { source: 'data', detail: 'your map' });
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
      value: active.length ? `${active.length} planting${active.length === 1 ? '' : 's'}` : 'Nothing yet',
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
  const beds = blocks.filter((b) => b.kind !== 'block');
  if (beds.length) {
    sections.push({
      title: 'Beds',
      items: capped(
        beds.map((b) => {
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

  return {
    kind: 'area',
    key,
    kicker,
    title: name,
    facts,
    next: nextAction(tasks, opts),
    sections,
    asOf: snapshot.generatedAt,
    provenance: mergeProvenance(provenance),
    href: cardHref('area', key)
  };
}

export function buildAreaCards(snapshot: FarmSnapshot, options: BuildOptions = {}): CardModel[] {
  return snapshot.areas
    .map((a) => buildAreaCard(snapshot, a.id, options))
    .filter((c): c is CardModel => c !== null);
}

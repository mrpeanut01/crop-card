import { STOCK_CATEGORY_TO_INVENTORY_TYPE } from '$lib/inventory/types';
import {
  cardHref,
  cardKey,
  mergeProvenance,
  type CardFact,
  type CardModel,
  type CardProvenance,
  type CardSection
} from '../model';
import type { FarmSnapshot, SnapshotStockCategory, SnapshotStockItem } from '../snapshot';
import {
  blockDisplayName,
  daysBetweenYmd,
  monthDay,
  resolveOptions,
  trimNumber,
  type BuildOptions
} from './common';
import { ymdInZone } from '$lib/prefs';

const EXPIRING_DAYS = 30;
const MAX_PLANNED = 6;

export const STOCK_CATEGORY_LABEL: Record<SnapshotStockCategory, string> = {
  herbicide: 'Herbicide',
  insecticide: 'Insecticide',
  fungicide: 'Fungicide',
  fertilizer: 'Fertilizer',
  seed: 'Seed',
  adjuvant: 'Adjuvant',
  fuel: 'Fuel',
  part: 'Part'
};

export function isLowStock(item: Pick<SnapshotStockItem, 'onHand' | 'reorderThreshold'>): boolean {
  return item.reorderThreshold !== null && item.onHand <= item.reorderThreshold;
}

function inventoryHref(item: SnapshotStockItem): string {
  const type = STOCK_CATEGORY_TO_INVENTORY_TYPE[item.category];
  return type ? `/inventory/${type}/${encodeURIComponent(item.id)}` : '/inventory';
}

export function buildStockCard(
  snapshot: FarmSnapshot,
  itemId: string,
  options: BuildOptions = {}
): CardModel | null {
  const item = snapshot.stock.find((s) => s.id === itemId);
  if (!item) return null;
  const opts = resolveOptions(snapshot, options);
  const today = ymdInZone(opts.now, opts.prefs.timeZone);

  const facts: CardFact[] = [
    {
      label: 'On hand',
      value: `${trimNumber(item.onHand, 2)} ${item.unit}`,
      provenance: 'data'
    }
  ];
  if (item.reorderThreshold !== null) {
    facts.push({
      label: 'Reorder at',
      value: `${trimNumber(item.reorderThreshold, 2)} ${item.unit}`,
      provenance: 'manual'
    });
  }
  if (item.earliestExpiry) {
    const days = daysBetweenYmd(today, item.earliestExpiry);
    const suffix =
      days === null ? '' : days < 0 ? ', expired' : days <= EXPIRING_DAYS ? ', soon' : '';
    facts.push({
      label: 'Expires',
      value: `${monthDay(item.earliestExpiry)}${suffix}`,
      provenance: 'manual'
    });
  }
  if (isLowStock(item)) facts.push({ label: 'Status', value: 'Low, reorder', provenance: 'data' });

  const sections: CardSection[] = [];
  if (item.pluginId) {
    const blocks = new Map(snapshot.blocks.map((b) => [b.id, b]));
    const planned = snapshot.plantings
      .filter((p) => p.cropPluginId === item.pluginId && p.status !== 'harvested')
      .map((p) => {
        const b = blocks.get(p.blockId);
        const when = p.plantingDate ? ` · ${monthDay(p.plantingDate)}` : '';
        return `${p.varietyDisplayName}${b ? ` · ${blockDisplayName(b)}` : ''}${when}`;
      });
    if (planned.length) {
      sections.push({
        title: 'Planned for',
        items:
          planned.length > MAX_PLANNED
            ? [...planned.slice(0, MAX_PLANNED), `+${planned.length - MAX_PLANNED} more`]
            : planned
      });
    }
  }

  const provenance: CardProvenance[] = [{ source: 'data', detail: 'your stock ledger' }];
  if (facts.some((f) => f.provenance === 'manual')) provenance.push({ source: 'manual' });

  const key = cardKey('stock', item.id);
  return {
    kind: 'stock',
    key,
    kicker: `Stock · ${STOCK_CATEGORY_LABEL[item.category] ?? 'Stock'}`,
    title: item.displayName,
    facts,
    next: { label: 'Open in inventory', href: inventoryHref(item) },
    sections,
    asOf: snapshot.generatedAt,
    provenance: mergeProvenance(provenance),
    href: cardHref('stock', key)
  };
}

export function buildStockCards(snapshot: FarmSnapshot, options: BuildOptions = {}): CardModel[] {
  return [...snapshot.stock]
    .sort((a, b) => a.displayName.localeCompare(b.displayName))
    .map((s) => buildStockCard(snapshot, s.id, options))
    .filter((c): c is CardModel => c !== null);
}

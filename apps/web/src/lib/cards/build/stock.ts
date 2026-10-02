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
  part: 'Part',
  feed: 'Feed',
  bedding: 'Bedding',
  'animal-health': 'Animal health'
};

export function isLowStock(item: Pick<SnapshotStockItem, 'onHand' | 'reorderThreshold'>): boolean {
  return item.reorderThreshold !== null && item.onHand <= item.reorderThreshold;
}

const STOCK_CATEGORY_KEY = {
  herbicide: 'cards.stock.cat.herbicide',
  insecticide: 'cards.stock.cat.insecticide',
  fungicide: 'cards.stock.cat.fungicide',
  fertilizer: 'cards.stock.cat.fertilizer',
  seed: 'cards.stock.cat.seed',
  adjuvant: 'cards.stock.cat.adjuvant',
  fuel: 'cards.stock.cat.fuel',
  part: 'cards.stock.cat.part',
  feed: 'cards.stock.cat.feed',
  bedding: 'cards.stock.cat.bedding',
  'animal-health': 'cards.stock.cat.animal-health'
} as const satisfies Record<SnapshotStockCategory, string>;

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
  const { tr } = opts;
  const loc = opts.prefs.locale;
  const today = ymdInZone(opts.now, opts.prefs.timeZone);

  const facts: CardFact[] = [
    {
      label: tr('cards.stock.onHand'),
      value: `${trimNumber(item.onHand, 2)} ${item.unit}`,
      provenance: 'data'
    }
  ];
  if (item.reorderThreshold !== null) {
    facts.push({
      label: tr('cards.stock.reorderAt'),
      value: `${trimNumber(item.reorderThreshold, 2)} ${item.unit}`,
      provenance: 'manual'
    });
  }
  if (item.earliestExpiry) {
    const days = daysBetweenYmd(today, item.earliestExpiry);
    const date = monthDay(item.earliestExpiry, loc);
    facts.push({
      label: tr('cards.stock.expires'),
      value:
        days === null
          ? date
          : days < 0
            ? tr('cards.stock.expired', { date })
            : days <= EXPIRING_DAYS
              ? tr('cards.stock.soon', { date })
              : date,
      provenance: 'manual'
    });
  }
  if (isLowStock(item))
    facts.push({
      label: tr('cards.stock.status'),
      value: tr('cards.stock.low'),
      provenance: 'data'
    });

  const sections: CardSection[] = [];
  if (item.pluginId) {
    const blocks = new Map(snapshot.blocks.map((b) => [b.id, b]));
    const planned = snapshot.plantings
      .filter((p) => p.cropPluginId === item.pluginId && p.status !== 'harvested')
      .map((p) => {
        const b = blocks.get(p.blockId);
        const when = p.plantingDate ? ` · ${monthDay(p.plantingDate, loc)}` : '';
        return `${p.varietyDisplayName}${b ? ` · ${blockDisplayName(b, loc)}` : ''}${when}`;
      });
    if (planned.length) {
      sections.push({
        title: tr('cards.stock.plannedFor'),
        items:
          planned.length > MAX_PLANNED
            ? [
                ...planned.slice(0, MAX_PLANNED),
                tr('cards.more', { count: planned.length - MAX_PLANNED })
              ]
            : planned
      });
    }
  }

  const provenance: CardProvenance[] = [{ source: 'data', detail: tr('cards.stock.provLedger') }];
  if (facts.some((f) => f.provenance === 'manual')) provenance.push({ source: 'manual' });

  const key = cardKey('stock', item.id);
  return {
    kind: 'stock',
    key,
    kicker: tr('cards.stock.kicker', {
      category: STOCK_CATEGORY_KEY[item.category]
        ? tr(STOCK_CATEGORY_KEY[item.category])
        : tr('cards.stock.stock')
    }),
    title: item.displayName,
    facts,
    next: { label: tr('cards.stock.openInventory'), href: inventoryHref(item) },
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

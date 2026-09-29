/**
 * Phase 30G: an inventory list row as a compact Card for phone widths. Same
 * fields as the table's columns, same detail link; only the rendering
 * differs (Invariant 8).
 */

import type { CardFact, CardModel, CardStatus } from '$lib/cards/model';
import type { InventoryType } from '$lib/inventory/types';
import { DEFAULT_PREFS, formatCalendarDate, type Prefs } from '$lib/prefs';
import { formatStockQuantity, isLabelUnitCategory } from '$lib/stock/units';
import type { InventoryRow, StockRow } from '../../routes/inventory/+page.server';

const NONE = '—';

export function inventoryRowId(row: InventoryRow): string {
  return row.kind === 'catalog' ? row.pluginId : row.id;
}

export function inventoryDetailHref(type: InventoryType, row: InventoryRow): string {
  return `/inventory/${type}/${encodeURIComponent(inventoryRowId(row))}`;
}

/** "200 seeds ordered, 50 seeds planned" for a stock row with expected
 *  lots, or null. Shown beside On hand so an order is never read as lost. */
export function expectedQuantityText(
  row: Pick<StockRow, 'onOrder' | 'planned' | 'defaultUnit' | 'category'>,
  prefs: Prefs = DEFAULT_PREFS
): string | null {
  const fmt = (n: number) =>
    formatStockQuantity(n, row.defaultUnit, prefs, {
      labelUnit: isLabelUnitCategory(row.category),
      category: row.category
    });
  const parts: string[] = [];
  if ((row.onOrder ?? 0) > 0) parts.push(`${fmt(row.onOrder ?? 0)} ordered`);
  if ((row.planned ?? 0) > 0) parts.push(`${fmt(row.planned ?? 0)} planned`);
  return parts.length ? parts.join(', ') : null;
}

export function inventoryRowCard(
  row: InventoryRow,
  type: InventoryType,
  prefs: Prefs = DEFAULT_PREFS,
  now: number = Date.now()
): CardModel {
  const href = inventoryDetailHref(type, row);
  const base = { sections: [], asOf: now, href, key: `inv_${type}_${inventoryRowId(row)}` };

  if (row.kind === 'catalog') {
    const crop = type === 'crop';
    const facts: CardFact[] = [
      { label: 'Id', value: row.pluginId },
      { label: crop ? 'Archetype' : 'Type', value: row.archetype ?? row.pluginType },
      { label: crop ? 'Family' : 'Source', value: row.cropFamily ?? NONE },
      {
        label: crop ? 'DTM' : 'Version',
        value: row.daysToMaturity
          ? `${row.daysToMaturity.min}–${row.daysToMaturity.max} d`
          : (row.version ?? NONE)
      }
    ];
    return {
      ...base,
      kind: crop ? 'careGuide' : 'stock',
      kicker: crop ? 'Crop' : 'Catalog',
      title: row.displayName,
      facts,
      provenance: [{ source: 'plugin', detail: row.pluginId }]
    };
  }

  const expected = expectedQuantityText(row, prefs);
  const facts: CardFact[] = [
    type === 'seed'
      ? { label: 'Crop', value: row.cropName ?? NONE }
      : { label: 'Kind', value: row.category },
    {
      label: 'On hand',
      value: formatStockQuantity(row.onHand, row.defaultUnit, prefs, {
        labelUnit: isLabelUnitCategory(row.category),
        category: row.category
      })
    },
    ...(expected ? [{ label: 'Coming', value: expected }] : []),
    { label: 'Lots', value: String(row.lotCount) },
    {
      label: 'Expires',
      value: row.earliestExpiry ? formatCalendarDate(row.earliestExpiry) : NONE
    }
  ];
  return {
    ...base,
    kind: 'stock',
    kicker: 'Stock',
    title: row.displayName,
    facts,
    ...(row.isLow ? { status: { label: 'Low', tone: 'rust' } as CardStatus } : {}),
    provenance: [{ source: 'data', detail: 'your stock ledger' }]
  };
}

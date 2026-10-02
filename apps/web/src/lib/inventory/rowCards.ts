/**
 * Phase 30G: an inventory list row as a compact Card for phone widths. Same
 * fields as the table's columns, same detail link; only the rendering
 * differs (Invariant 8).
 */

import type { CardFact, CardModel, CardStatus } from '$lib/cards/model';
import type { InventoryType } from '$lib/inventory/types';
import { DEFAULT_PREFS, formatCalendarDate, type Prefs } from '$lib/prefs';
import { formatStockQuantity, isLabelUnitCategory } from '$lib/stock/units';
import { stockCategoryLabel } from '$lib/stock/categories';
import { t } from '$lib/i18n';
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
  if ((row.onOrder ?? 0) > 0)
    parts.push(t(prefs.locale, 'inv.form.amountOrdered', { amount: fmt(row.onOrder ?? 0) }));
  if ((row.planned ?? 0) > 0)
    parts.push(t(prefs.locale, 'inv.form.amountPlanned', { amount: fmt(row.planned ?? 0) }));
  return parts.length ? parts.join(', ') : null;
}

export function inventoryRowCard(
  row: InventoryRow,
  type: InventoryType,
  prefs: Prefs = DEFAULT_PREFS,
  now: number = Date.now()
): CardModel {
  const href = inventoryDetailHref(type, row);
  const tr = (key: Parameters<typeof t>[1]) => t(prefs.locale, key);
  const base = { sections: [], asOf: now, href, key: `inv_${type}_${inventoryRowId(row)}` };

  if (row.kind === 'catalog') {
    const crop = type === 'crop';
    const facts: CardFact[] = [
      { label: tr('inv.list.col.id'), value: row.pluginId },
      {
        label: crop ? tr('inv.list.col.archetype') : tr('inv.list.col.type'),
        value: row.archetype ?? row.pluginType
      },
      {
        label: crop ? tr('inv.list.col.family') : tr('inv.list.col.source'),
        value: row.cropFamily ?? NONE
      },
      {
        label: crop ? tr('inv.list.col.dtm') : tr('inv.list.col.version'),
        value: row.daysToMaturity
          ? `${row.daysToMaturity.min}–${row.daysToMaturity.max} d`
          : (row.version ?? NONE)
      }
    ];
    return {
      ...base,
      kind: crop ? 'careGuide' : 'stock',
      kicker: crop ? tr('inv.list.col.crop') : tr('inv.list.catalog'),
      title: row.displayName,
      facts,
      provenance: [{ source: 'plugin', detail: row.pluginId }]
    };
  }

  const expected = expectedQuantityText(row, prefs);
  const facts: CardFact[] = [
    type === 'seed'
      ? { label: tr('inv.list.col.crop'), value: row.cropName ?? NONE }
      : { label: tr('inv.list.col.kind'), value: stockCategoryLabel(row.category, prefs.locale) },
    {
      label: tr('inv.list.col.onHand'),
      value: formatStockQuantity(row.onHand, row.defaultUnit, prefs, {
        labelUnit: isLabelUnitCategory(row.category),
        category: row.category
      })
    },
    ...(expected ? [{ label: tr('inv.card.coming'), value: expected }] : []),
    { label: tr('inv.list.col.lots'), value: String(row.lotCount) },
    {
      label: tr('inv.list.col.expires'),
      value: row.earliestExpiry
        ? formatCalendarDate(row.earliestExpiry, undefined, undefined, prefs.locale)
        : NONE
    }
  ];
  return {
    ...base,
    kind: 'stock',
    kicker: tr('inv.list.stock'),
    title: row.displayName,
    facts,
    ...(row.isLow ? { status: { label: tr('inv.card.low'), tone: 'rust' } as CardStatus } : {}),
    provenance: [{ source: 'data', detail: tr('inv.card.ledger') }]
  };
}

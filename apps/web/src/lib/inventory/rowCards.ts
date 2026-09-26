/**
 * Phase 30G: an inventory list row as a compact Card for phone widths. Same
 * fields as the table's columns, same detail link; only the rendering
 * differs (Invariant 8).
 */

import type { CardFact, CardModel, CardStatus } from '$lib/cards/model';
import type { InventoryType } from '$lib/inventory/types';
import {
  DEFAULT_PREFS,
  formatCalendarDate,
  formatInstant,
  formatLabelRate,
  formatQuantity,
  type Prefs
} from '$lib/prefs';
import { formatStockQuantity, isLabelUnitCategory } from '$lib/stock/units';
import type { InventoryRow } from '../../routes/inventory/+page.server';

const NONE = '—';

export function inventoryRowId(row: InventoryRow): string {
  return row.kind === 'catalog' ? row.pluginId : row.id;
}

export function inventoryDetailHref(type: InventoryType, row: InventoryRow): string {
  return `/inventory/${type}/${encodeURIComponent(inventoryRowId(row))}`;
}

function gpaText(gpa: number, prefs: Prefs): string {
  const metric =
    prefs.units === 'metric' ? ` (${formatQuantity(gpa, 'volumePerArea', prefs)})` : '';
  return `${gpa.toFixed(1)}${metric}`;
}

function sprayerStatus(row: Extract<InventoryRow, { kind: 'sprayer' }>): CardStatus {
  if (row.deconRequired) return { label: 'Decon', tone: 'rust' };
  if (row.lastCalibratedAt) return { label: 'OK', tone: 'forest' };
  return { label: 'New', tone: 'neutral' };
}

export function inventoryRowCard(
  row: InventoryRow,
  type: InventoryType,
  prefs: Prefs = DEFAULT_PREFS,
  now: number = Date.now()
): CardModel {
  const href = inventoryDetailHref(type, row);
  const base = { sections: [], asOf: now, href, key: `inv_${type}_${inventoryRowId(row)}` };

  if (row.kind === 'sprayer') {
    const facts: CardFact[] = [
      { label: 'Nozzle', value: row.nozzleType ?? NONE },
      {
        label: 'Tank',
        value: row.tankGal != null ? formatLabelRate(row.tankGal, 'volume', prefs) : NONE
      },
      {
        label: 'Last cal',
        value: row.lastCalibratedAt ? formatInstant(row.lastCalibratedAt, prefs, 'date') : NONE
      },
      { label: 'GPA', value: row.measuredGpa != null ? gpaText(row.measuredGpa, prefs) : NONE }
    ];
    return {
      ...base,
      kind: 'equipment',
      kicker: 'Sprayer',
      title: row.label,
      facts,
      status: sprayerStatus(row),
      provenance: [{ source: 'data' }]
    };
  }

  if (row.kind === 'catalog') {
    const crop = type === 'crop';
    const facts: CardFact[] = [
      { label: 'Plugin id', value: row.pluginId },
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
      kicker: crop ? 'Crop plugin' : 'Catalog',
      title: row.displayName,
      facts,
      provenance: [{ source: 'plugin', detail: row.pluginId }]
    };
  }

  const facts: CardFact[] = [
    { label: 'Category', value: row.category },
    {
      label: 'On hand',
      value: formatStockQuantity(row.onHand, row.defaultUnit, prefs, {
        labelUnit: isLabelUnitCategory(row.category)
      })
    },
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

/** What an entry can be linked to, for the add and edit forms. */

import { eq } from 'drizzle-orm';
import { db } from '$lib/db/client';
import { stockItems, stockLots } from '$lib/db/schema';
import { withTenant } from '$lib/db/tenant';
import { getHarvestEvent } from '$lib/db/harvestEvents';
import { farmTimeZone } from '$lib/db/userProfile';
import { lotsForRole } from './redact';
import type { FarmNames } from './profit.server';
import type { EntryFormOptions, LinkOption } from './formTypes';

export type { EntryFormOptions, LinkOption };

const byLabel = (a: LinkOption, b: LinkOption) => a.label.localeCompare(b.label);

export function entryFormOptions(names: FarmNames): EntryFormOptions {
  const plantings = Object.keys(names.plantingPlugin).map((id) => {
    const crop = names.crop[names.plantingPlugin[id]];
    const variety = names.plantingLabel[id];
    return { id, label: variety && variety !== crop ? `${crop}, ${variety}` : crop };
  });
  return {
    plantings: plantings.sort(byLabel),
    areas: Object.entries(names.area)
      .map(([id, label]) => ({ id, label }))
      .sort(byLabel),
    beds: [...names.blockField.entries()]
      .map(([id, fieldId]) => ({ id, fieldId, label: names.bed[id] ?? 'Bed' }))
      .sort(byLabel),
    groups: Object.entries(names.group)
      .map(([id, label]) => ({ id, label }))
      .sort(byLabel),
    animals: Object.entries(names.animal)
      .map(([id, label]) => ({ id, label }))
      .sort(byLabel),
    timeZone: farmTimeZone()
  };
}

export interface LotSummary {
  id: string;
  itemName: string;
  stockCategory: string;
  lotNumber: string | null;
  receivedAt: number;
  receivedCostCents: number | null;
}

/** A lot for the "Record purchase as expense" prefill. Owner only. */
export function lotSummary(lotId: string, role: string): LotSummary | null {
  const row = db
    .select({
      id: stockLots.id,
      lotNumber: stockLots.lotNumber,
      receivedAt: stockLots.receivedAt,
      receivedCostCents: stockLots.receivedCostCents,
      itemName: stockItems.displayName,
      stockCategory: stockItems.category
    })
    .from(stockLots)
    .innerJoin(stockItems, eq(stockLots.stockItemId, stockItems.id))
    .where(withTenant(stockLots, eq(stockLots.id, lotId), withTenant(stockItems)))
    .get();
  if (!row) return null;
  const [visible] = lotsForRole([{ receivedCostCents: row.receivedCostCents ?? undefined }], role);
  return {
    id: row.id,
    itemName: row.itemName,
    stockCategory: row.stockCategory,
    lotNumber: row.lotNumber ?? null,
    receivedAt: row.receivedAt.getTime(),
    receivedCostCents: visible.receivedCostCents ?? null
  };
}

export interface HarvestSummary {
  id: string;
  cropId: string | null;
  occurredAt: number;
  quantity: string | null;
}

export function harvestSummary(eventId: string): HarvestSummary | null {
  const e = getHarvestEvent(eventId);
  if (!e) return null;
  return {
    id: e.id,
    cropId: e.cropId ?? null,
    occurredAt: e.occurredAt,
    quantity: e.quantity ?? null
  };
}

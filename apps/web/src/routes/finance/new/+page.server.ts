/**
 * /finance/new: add an expense or income. Owner only. Query parameters
 * prefill it: `kind`, `cropId`, `fieldId`, `animalId`, `animalGroupId`,
 * `quantity`, `unit`, plus `stockLotId` ("Record purchase as expense",
 * F2-11) or `harvestEventId` ("Record a sale", F2-15).
 */

import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { requireMoneyWriter } from '$lib/finance/access';
import { expenseCategoryForStock, type LedgerKind } from '$lib/finance/categories';
import { formatMoney } from '$lib/finance/money';
import { farmNames } from '$lib/finance/profit.server';
import { entryFormOptions, harvestSummary, lotSummary } from '$lib/finance/formOptions.server';
import type { EntryFormValue } from '$lib/finance/formTypes';
import { liveExpenseForLot } from '$lib/db/ledger';
import { parseHarvestQuantity } from '$lib/finance/harvestSale';

export const load: PageServerLoad = async (event) => {
  const user = requireMoneyWriter(event);
  const q = event.url.searchParams;
  const kind: LedgerKind = q.get('kind') === 'income' ? 'income' : 'expense';
  const names = await farmNames();
  const options = entryFormOptions(names);
  const known = (id: string | null, list: Array<{ id: string }>) =>
    id && list.some((o) => o.id === id) ? id : null;

  const qty = Number(q.get('quantity'));
  const value: EntryFormValue = {
    kind,
    occurredAt: Date.now(),
    amountCents: null,
    category: kind === 'income' ? 'produce-sale' : 'supplies',
    description: null,
    cropId: known(q.get('cropId'), options.plantings),
    fieldId: known(q.get('fieldId'), options.areas),
    blockId: null,
    animalId: known(q.get('animalId'), options.animals),
    animalGroupId: known(q.get('animalGroupId'), options.groups),
    stockLotId: null,
    harvestEventId: null,
    enterprise: null,
    quantity: Number.isFinite(qty) && qty > 0 ? qty : null,
    unit: q.get('unit')?.slice(0, 30) || null
  };
  if (value.animalId || value.animalGroupId)
    value.category = kind === 'income' ? 'animal-product-sale' : 'feed';

  let linkNote: string | null = null;
  let alreadyExpensed: string | null = null;

  const lotId = q.get('stockLotId');
  if (lotId && kind === 'expense') {
    const lot = lotSummary(lotId, user.role);
    if (!lot) throw error(404, 'No such stock lot');
    const existing = liveExpenseForLot(lot.id);
    if (existing) alreadyExpensed = existing.id;
    value.stockLotId = lot.id;
    value.category = expenseCategoryForStock(lot.stockCategory);
    value.description =
      `Bought ${lot.itemName}${lot.lotNumber ? `, lot ${lot.lotNumber}` : ''}`.slice(0, 200);
    value.occurredAt = lot.receivedAt;
    value.amountCents = lot.receivedCostCents;
    linkNote =
      lot.receivedCostCents === null
        ? `Purchase of ${lot.itemName}. The lot has no cost saved, so type what you paid.`
        : `Purchase of ${lot.itemName}. The lot says it cost ${formatMoney(lot.receivedCostCents)}.`;
  }

  const harvestId = q.get('harvestEventId');
  if (harvestId && kind === 'income') {
    const h = harvestSummary(harvestId);
    if (!h) throw error(404, 'No such harvest record');
    value.harvestEventId = h.id;
    value.cropId = known(h.cropId, options.plantings) ?? value.cropId;
    value.category = 'produce-sale';
    value.occurredAt = Date.now();
    const parsed = parseHarvestQuantity(h.quantity);
    if (parsed && value.quantity === null) {
      value.quantity = parsed.quantity;
      value.unit = value.unit ?? parsed.unit;
    }
    linkNote = 'A sale from this harvest. Several sales from one harvest are fine.';
  }

  const year = new Date(value.occurredAt).getUTCFullYear();
  return { value, options, linkNote, alreadyExpensed, backHref: `/finance?year=${year}` };
};

/**
 * /finance/new: add an expense or income. Owner only. Query parameters
 * prefill it: `kind`, `cropId`, `fieldId`, `animalId`, `animalGroupId`,
 * `quantity`, `unit`, plus `stockLotId` ("Record purchase as expense",
 * F2-11) or `harvestEventId` ("Record a sale", F2-15), with an optional
 * `dispositionId` ("Also record the money", Phase 33B B-31).
 */

import { error } from '@sveltejs/kit';
import { t } from '$lib/i18n';
import type { PageServerLoad } from './$types';
import { requireMoneyWriter } from '$lib/finance/access';
import { expenseCategoryForStock, type LedgerKind } from '$lib/finance/categories';
import { formatMoney } from '$lib/finance/money';
import { currentSeasonYear, farmNames } from '$lib/finance/profit.server';
import { entryFormOptions, harvestSummary, lotSummary } from '$lib/finance/formOptions.server';
import type { EntryFormValue } from '$lib/finance/formTypes';
import { liveExpenseForLot } from '$lib/db/ledger';
import { parseHarvestQuantity } from '$lib/finance/harvestSale';
import { getHarvestDisposition } from '$lib/db/harvestDispositions';

export const load: PageServerLoad = async (event) => {
  const user = requireMoneyWriter(event);
  const locale = event.locals.locale;
  const q = event.url.searchParams;
  const kind: LedgerKind = q.get('kind') === 'income' ? 'income' : 'expense';
  const names = await farmNames(locale);
  const options = entryFormOptions(names, locale);
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
    if (!lot) throw error(404, t(locale, 'finance.err.noLot'));
    const existing = liveExpenseForLot(lot.id);
    if (existing) alreadyExpensed = existing.id;
    value.stockLotId = lot.id;
    value.category = expenseCategoryForStock(lot.stockCategory);
    value.description = (
      lot.lotNumber
        ? t(locale, 'finance.new.boughtLot', { item: lot.itemName, lot: lot.lotNumber })
        : t(locale, 'finance.new.bought', { item: lot.itemName })
    ).slice(0, 200);
    value.occurredAt = lot.receivedAt;
    value.amountCents = lot.receivedCostCents;
    linkNote =
      lot.receivedCostCents === null
        ? t(locale, 'finance.new.purchaseNoCost', { item: lot.itemName })
        : t(locale, 'finance.new.purchaseCost', {
            item: lot.itemName,
            cost: formatMoney(lot.receivedCostCents)
          });
  }

  const harvestId = q.get('harvestEventId');
  if (harvestId && kind === 'income') {
    const h = harvestSummary(harvestId);
    if (!h) throw error(404, t(locale, 'finance.err.noHarvest'));
    value.harvestEventId = h.id;
    value.cropId = known(h.cropId, options.plantings) ?? value.cropId;
    value.category = 'produce-sale';
    value.occurredAt = Date.now();
    const parsed = parseHarvestQuantity(h.quantity);
    if (parsed && value.quantity === null) {
      value.quantity = parsed.quantity;
      value.unit = value.unit ?? parsed.unit;
    }
    linkNote = t(locale, 'finance.new.saleFromHarvest');
    const disposition = getHarvestDisposition(q.get('dispositionId') ?? '');
    if (
      disposition &&
      disposition.harvestEventId === h.id &&
      disposition.kind === 'sold' &&
      !disposition.ledgerEntryId
    ) {
      value.dispositionId = disposition.id;
      value.quantity = disposition.quantity;
      value.unit = disposition.unit.slice(0, 30);
      value.occurredAt = disposition.occurredAt;
      linkNote = t(locale, 'finance.new.saleOfDisposition', {
        qty: disposition.quantity,
        unit: disposition.unit
      });
    }
  }

  const year = currentSeasonYear(value.occurredAt);
  return { value, options, linkNote, alreadyExpensed, backHref: `/finance?year=${year}` };
};

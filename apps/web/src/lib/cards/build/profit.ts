/**
 * The Season Profit Card (F2-18). Built on the server from `seasonProfit()`
 * for the owner only, printable from /finance. Record-only: never in the
 * offline snapshot for any role, and `/c/pf_<year>` opens the owner-only
 * /finance/profit/<year>.
 */

import { formatMoney } from '$lib/finance/money';
import { hasUnallocated, inputCostText, labourText, netLabel } from '$lib/finance/format';
import { NOT_TIED_LABEL, type SeasonProfit } from '$lib/finance/profit';
import { cardKey, type CardFact, type CardModel, type CardSection } from '../model';

export function profitCardHref(year: number | string): string {
  return `/finance/profit/${encodeURIComponent(String(year))}`;
}

export function buildProfitCard(
  year: number,
  profit: SeasonProfit,
  opts: { asOf: number; farmName?: string | null }
): CardModel {
  const rate = profit.labourRateCentsPerHour;
  const facts: CardFact[] = [
    { label: 'Income', value: formatMoney(profit.cash.incomeCents), provenance: 'manual' },
    { label: 'Expenses', value: formatMoney(profit.cash.expenseCents), provenance: 'manual' },
    { label: 'Net cash', value: formatMoney(profit.cash.netCents), provenance: 'manual' }
  ];
  if (profit.lotPurchaseCents > 0) {
    facts.push({
      label: 'Stock bought',
      value: `${formatMoney(profit.lotPurchaseCents)}, counted below as it is used`,
      provenance: 'manual'
    });
  }
  facts.push({
    label: 'Labour rate',
    value: rate === null ? 'Labour rate not set' : `${formatMoney(rate)} an hour, an estimate`,
    provenance: 'manual'
  });

  const sections: CardSection[] = profit.enterprises.map((e) => {
    const items = [
      `Income: ${formatMoney(e.incomeCents)}`,
      `Direct costs: ${formatMoney(e.directExpenseCents)}`,
      `Inputs used: ${inputCostText(e)}${e.includesAreaInputs ? ' (some not tied to one planting)' : ''}`,
      `Labour: ${labourText(e, rate)}`,
      `${netLabel(e)}: ${formatMoney(e.netCents)}`
    ];
    if (e.netAfterLabourCents !== null) {
      items.push(`Net after labour estimate: ${formatMoney(e.netAfterLabourCents)}`);
    }
    return { title: e.label, items, provenance: 'data' as const };
  });

  if (hasUnallocated(profit)) {
    const u = profit.unallocated;
    const items = [
      `Income: ${formatMoney(u.incomeCents)}`,
      `Direct costs: ${formatMoney(u.directExpenseCents)}`
    ];
    if (u.inputCostCents || u.inputCostUnknownCount) {
      items.push(
        `Inputs used: ${inputCostText({ inputCostCents: u.inputCostCents, inputCostUnknownCount: u.inputCostUnknownCount })}`
      );
    }
    if (u.labourMinutes) {
      items.push(
        `Labour: ${labourText({ labourMinutes: u.labourMinutes, labourCents: u.labourCents, labourNotCounted: false }, rate)}`
      );
    }
    sections.push({ title: NOT_TIED_LABEL, items });
  }

  if (sections.length === 0) {
    sections.push({ title: 'Nothing yet', items: ['No money or stock use recorded this year.'] });
  }

  return {
    kind: 'profit',
    key: cardKey('profit', String(year)),
    kicker: `Season profit · ${year}`,
    title: opts.farmName ? `${opts.farmName} season profit` : 'Season profit',
    facts,
    sections,
    asOf: opts.asOf,
    provenance: [
      { source: 'manual', detail: 'Income and expenses you entered' },
      { source: 'data', detail: 'Inputs used, from stock records and lot costs' }
    ],
    href: profitCardHref(year),
    notices: [
      'Inputs used and labour are estimates from your records. They are never part of the cash totals.'
    ]
  };
}

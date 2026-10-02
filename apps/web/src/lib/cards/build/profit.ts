/**
 * The Season Profit Card (F2-18). Built on the server from `seasonProfit()`
 * for the owner only, printable from /finance. Record-only: never in the
 * offline snapshot for any role, and `/c/pf_<year>` opens the owner-only
 * /finance/profit/<year>.
 */

import { formatMoney } from '$lib/finance/money';
import { hasUnallocated, inputCostText, labourText, netLabel } from '$lib/finance/format';
import { enterpriseName, notTiedLabel, type SeasonProfit } from '$lib/finance/profit';
import { cardKey, type CardFact, type CardModel, type CardSection } from '../model';
import { createT } from '$lib/i18n';

export function profitCardHref(year: number | string): string {
  return `/finance/profit/${encodeURIComponent(String(year))}`;
}

export function buildProfitCard(
  year: number,
  profit: SeasonProfit,
  opts: { asOf: number; farmName?: string | null; locale?: string | null }
): CardModel {
  const tr = createT(opts.locale);
  const rate = profit.labourRateCentsPerHour;
  const facts: CardFact[] = [
    {
      label: tr('cards.profit.income'),
      value: formatMoney(profit.cash.incomeCents),
      provenance: 'manual'
    },
    {
      label: tr('cards.profit.expenses'),
      value: formatMoney(profit.cash.expenseCents),
      provenance: 'manual'
    },
    { label: tr('cards.profit.netCash'), value: formatMoney(profit.cash.netCents), provenance: 'manual' }
  ];
  if (profit.lotPurchaseCents > 0) {
    facts.push({
      label: tr('cards.profit.stockBought'),
      value: tr('cards.profit.stockBoughtValue', { money: formatMoney(profit.lotPurchaseCents) }),
      provenance: 'manual'
    });
  }
  facts.push({
    label: tr('cards.profit.labourRate'),
    value:
      rate === null
        ? tr('cards.profit.labourRateNotSet')
        : tr('cards.profit.perHour', { money: formatMoney(rate) }),
    provenance: 'manual'
  });

  const line = (label: string, value: string) => `${label}: ${value}`;
  const sections: CardSection[] = profit.enterprises.map((e) => {
    const items = [
      line(tr('cards.profit.income'), formatMoney(e.incomeCents)),
      line(tr('cards.profit.directCosts'), formatMoney(e.directExpenseCents)),
      line(
        tr('cards.profit.inputsUsed'),
        `${inputCostText(e, opts.locale)}${e.includesAreaInputs ? tr('cards.profit.someNotTied') : ''}`
      ),
      line(tr('cards.profit.labour'), labourText(e, rate, opts.locale)),
      `${netLabel(e, opts.locale)}: ${formatMoney(e.netCents)}`
    ];
    if (e.netAfterLabourCents !== null) {
      items.push(line(tr('cards.profit.netAfterLabour'), formatMoney(e.netAfterLabourCents)));
    }
    return { title: enterpriseName(e, opts.locale), items, provenance: 'data' as const };
  });

  if (hasUnallocated(profit)) {
    const u = profit.unallocated;
    const items = [
      line(tr('cards.profit.income'), formatMoney(u.incomeCents)),
      line(tr('cards.profit.directCosts'), formatMoney(u.directExpenseCents))
    ];
    if (u.inputCostCents || u.inputCostUnknownCount) {
      items.push(
        line(
          tr('cards.profit.inputsUsed'),
          inputCostText({
            inputCostCents: u.inputCostCents,
            inputCostUnknownCount: u.inputCostUnknownCount
          }, opts.locale)
        )
      );
    }
    if (u.labourMinutes) {
      items.push(
        line(
          tr('cards.profit.labour'),
          labourText(
            { labourMinutes: u.labourMinutes, labourCents: u.labourCents, labourNotCounted: false },
            rate,
            opts.locale
          )
        )
      );
    }
    sections.push({ title: notTiedLabel(opts.locale), items });
  }

  if (sections.length === 0) {
    sections.push({
      title: tr('cards.profit.nothingYet'),
      items: [tr('cards.profit.nothingRecorded')]
    });
  }

  return {
    kind: 'profit',
    key: cardKey('profit', String(year)),
    kicker: tr('cards.profit.kicker', { year }),
    title: opts.farmName
      ? tr('cards.profit.titleNamed', { farm: opts.farmName })
      : tr('cards.profit.title'),
    facts,
    sections,
    asOf: opts.asOf,
    provenance: [
      { source: 'manual', detail: tr('cards.profit.provEntered') },
      { source: 'data', detail: tr('cards.profit.provInputs') }
    ],
    href: profitCardHref(year),
    notices: [tr('cards.profit.notice')]
  };
}

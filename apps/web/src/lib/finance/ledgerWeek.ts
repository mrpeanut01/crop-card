/** Cash in and out over a range, for the owner's Monday digest email
 *  (F4-5). Live entries only, no derived costs. Server only; owner only. */

import { listLedgerEntries } from '$lib/db/ledger';
import type { CashTotals } from './profit';

export function cashForRange(fromMs: number, toMs: number): CashTotals {
  let incomeCents = 0;
  let expenseCents = 0;
  for (const e of listLedgerEntries({ fromMs, toMs, state: 'live' })) {
    if (e.kind === 'income') incomeCents += e.amountCents;
    else expenseCents += e.amountCents;
  }
  return { incomeCents, expenseCents, netCents: incomeCents - expenseCents };
}

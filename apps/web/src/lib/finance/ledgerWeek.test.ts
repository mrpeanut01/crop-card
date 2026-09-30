// @vitest-environment node
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { db } from '$lib/db/client';
import { owners } from '$lib/db/schema';
import { runWithTenant } from '$lib/db/tenant';
import { insertLedgerEntry, softDeleteLedgerEntry } from '$lib/db/ledger';
import { cashForRange } from './ledgerWeek';

function farm(): string {
  const id = `week-${randomUUID()}`;
  db.insert(owners).values({ id, name: id, slug: id, billingStatus: 'active' }).run();
  return id;
}

describe('cashForRange', () => {
  it('sums live entries in the range for the active Owner only', () => {
    const a = farm();
    const b = farm();
    const at = Date.UTC(2026, 5, 3);
    const add = (kind: 'income' | 'expense', amountCents: number, occurredAt = at) =>
      insertLedgerEntry(
        {
          kind,
          amountCents,
          occurredAt,
          category: kind === 'income' ? 'produce-sale' : 'supplies'
        },
        null
      );
    runWithTenant(a, () => {
      add('income', 5000);
      add('expense', 1200);
      add('income', 999, Date.UTC(2026, 5, 20));
      softDeleteLedgerEntry(add('expense', 700).id, null);
    });
    runWithTenant(b, () => add('income', 100_000));
    const range = [Date.UTC(2026, 5, 1), Date.UTC(2026, 5, 8)] as const;
    expect(runWithTenant(a, () => cashForRange(...range))).toEqual({
      incomeCents: 5000,
      expenseCents: 1200,
      netCents: 3800
    });
    expect(runWithTenant(b, () => cashForRange(...range)).incomeCents).toBe(100_000);
  });
});

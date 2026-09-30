import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { LEDGER_CSV_HEADER, csvSafe, ledgerCsv } from './csv';
import { personName } from './people';

describe('ledgerCsv (F2-16)', () => {
  it('writes the fixed header and one row per entry', () => {
    const csv = ledgerCsv([
      {
        date: '2026-05-01',
        kind: 'income',
        category: 'produce-sale',
        amountCents: 123456,
        description: 'Saturday market, "big" day',
        linkedTo: 'Crop: Tomatoes',
        enterprise: 'Tomatoes',
        quantity: 40,
        unit: 'lb',
        enteredBy: 'maria'
      }
    ]);
    const [head, row] = csv.trim().split('\r\n');
    expect(head).toBe(LEDGER_CSV_HEADER.join(','));
    expect(row).toBe(
      '2026-05-01,income,Produce sale,1234.56,"Saturday market, ""big"" day",Crop: Tomatoes,Tomatoes,40,lb,maria'
    );
  });

  it('defuses formula cells', () => {
    for (const bad of ['=SUM(A1)', '+1', '-2', '@cmd', '\tx']) {
      expect(csvSafe(bad).startsWith("'")).toBe(true);
    }
    expect(csvSafe('Seed order')).toBe('Seed order');
  });

  it('property: no cell of any row starts a formula', () => {
    fc.assert(
      fc.property(fc.string(), fc.string(), (description, enterprise) => {
        const csv = ledgerCsv([
          {
            date: '2026-01-01',
            kind: 'expense',
            category: 'other',
            amountCents: 1,
            description,
            linkedTo: null,
            enterprise,
            quantity: null,
            unit: null,
            enteredBy: null
          }
        ]);
        const cells = csv.split('\r\n')[1];
        expect(cells.includes(',=') || cells.includes(',+') || cells.includes(',@')).toBe(false);
      })
    );
  });
});

describe('personName (F0-12)', () => {
  it('never shows a whole email or phone number', () => {
    expect(personName({ email: 'maria@example.com', phone: null })).toBe('maria');
    expect(personName({ email: null, phone: '+1 (540) 555-1234' })).toBe('phone ending 1234');
    expect(personName({ email: 'x@y.z', phone: null, displayName: 'Maria G' })).toBe('Maria G');
  });
});

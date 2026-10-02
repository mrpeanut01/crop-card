// @vitest-environment node
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { db } from './client';
import { owners } from './schema';
import { runWithTenant } from './tenant';
import { createField } from './fields';
import { createBlock } from './blocks';
import { insertCropHarvestEvent } from './harvestEvents';
import {
  countDispositionsForHarvest,
  getHarvestDisposition,
  insertHarvestDisposition,
  linkNewSaleToDisposition,
  listDispositions,
  listDispositionsForHarvests,
  setDispositionLedgerEntry,
  updateHarvestDisposition
} from './harvestDispositions';
import { deleteHarvestDisposition } from './admin';
import { insertLedgerEntry } from './ledger';

function seed(label: string) {
  const ownerId = `dispx-${label}-${randomUUID()}`;
  db.insert(owners)
    .values({ id: ownerId, name: ownerId, slug: ownerId, billingStatus: 'active' })
    .run();
  return runWithTenant(ownerId, () => {
    const field = createField({ name: 'Garden', kind: 'garden' });
    const block = createBlock({ name: 'Bed', fieldId: field.id, acres: 0.01 });
    const harvest = insertCropHarvestEvent({
      blockId: block.id,
      cropPluginId: 'tomato-amish-paste',
      occurredAt: Date.now() - 3_600_000,
      quantity: '10 lb'
    });
    const d = insertHarvestDisposition({
      harvestEventId: harvest.id,
      kind: 'sold',
      quantity: 2,
      unit: 'lb',
      occurredAt: Date.now() - 60_000,
      recipient: null,
      soldAsOrganic: null
    });
    const entry = insertLedgerEntry(
      { kind: 'income', occurredAt: Date.now(), amountCents: 100, category: 'produce-sale' },
      null
    );
    return { ownerId, harvestId: harvest.id, dispositionId: d.id, entryId: entry.id };
  });
}

describe('harvest disposition repo is owner-scoped', () => {
  it("never reads, counts, changes or deletes another Owner's dispositions", () => {
    const a = seed('a');
    const b = seed('b');
    fc.assert(
      fc.property(fc.boolean(), (aIsReader) => {
        const [mine, theirs] = aIsReader ? [a, b] : [b, a];
        runWithTenant(mine.ownerId, () => {
          expect(getHarvestDisposition(theirs.dispositionId)).toBeUndefined();
          expect(listDispositionsForHarvests([theirs.harvestId]).size).toBe(0);
          expect(countDispositionsForHarvest(theirs.harvestId)).toBe(0);
          const ids = listDispositions({ fromMs: 0, toMs: Date.now() + 60_000 }).map((d) => d.id);
          expect(ids).toContain(mine.dispositionId);
          expect(ids).not.toContain(theirs.dispositionId);
          expect(updateHarvestDisposition(theirs.dispositionId, { quantity: 99 })).toBeUndefined();
          expect(setDispositionLedgerEntry(theirs.dispositionId, mine.entryId)).toBeUndefined();
          expect(
            linkNewSaleToDisposition(theirs.dispositionId, theirs.harvestId, mine.entryId)
          ).toBe(false);
          expect(deleteHarvestDisposition(theirs.dispositionId).removed).toEqual({});
        });
      }),
      { numRuns: 10 }
    );
    for (const s of [a, b]) {
      runWithTenant(s.ownerId, () => {
        const d = getHarvestDisposition(s.dispositionId);
        expect(d?.quantity).toBe(2);
        expect(d?.ledgerEntryId).toBeNull();
      });
    }
  });
});

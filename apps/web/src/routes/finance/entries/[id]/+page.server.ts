/** /finance/entries/:id: edit one entry and see its history. Owner only. */

import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { getLedgerEntry, listLedgerChanges } from '$lib/db/ledger';
import { requireMoneyReader } from '$lib/finance/access';
import { enteredByNames, farmNames } from '$lib/finance/profit.server';
import { entryFormOptions } from '$lib/finance/formOptions.server';
import type { EntryFormValue } from '$lib/finance/formTypes';
import { farmTimeZone } from '$lib/db/userProfile';

export const load: PageServerLoad = async (event) => {
  const user = requireMoneyReader(event);
  const entry = getLedgerEntry(event.params.id);
  if (!entry) throw error(404, 'No such entry');
  const options = entryFormOptions(await farmNames());
  const changes = listLedgerChanges(entry.id);
  const people = enteredByNames(changes.map((c) => c.changedById));
  const value: EntryFormValue = {
    id: entry.id,
    kind: entry.kind,
    occurredAt: entry.occurredAt,
    amountCents: entry.amountCents,
    category: entry.category ?? 'other',
    description: entry.description,
    cropId: entry.cropId,
    fieldId: entry.fieldId,
    blockId: entry.blockId,
    animalId: entry.animalId,
    animalGroupId: entry.animalGroupId,
    stockLotId: entry.stockLotId,
    harvestEventId: entry.harvestEventId,
    enterprise: entry.enterprise,
    quantity: entry.quantity,
    unit: entry.unit
  };
  const year = new Date(entry.occurredAt).getUTCFullYear();
  return {
    value,
    options,
    deleted: entry.deletedAt !== null,
    canWrite: !user.impersonating,
    backHref: `/finance?year=${year}`,
    timeZone: farmTimeZone(),
    history: changes.map((c) => ({
      id: c.id,
      action: c.action,
      at: c.changedAt,
      by: c.changedById ? (people.get(c.changedById) ?? null) : null,
      beforeCents: c.before?.amountCents ?? null,
      afterCents: c.after?.amountCents ?? null
    }))
  };
};

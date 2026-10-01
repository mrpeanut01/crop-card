// @vitest-environment node
/**
 * Phase 32G (G2-05, G2-06): a hay cutting saved more than 48 hours after
 * its mow date carries "Saved N days after its date" on its /records row
 * and its record card. Other kinds carry nothing.
 */
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { db } from '$lib/db/client';
import { crops, owners, users } from '$lib/db/schema';
import { runWithTenant, runWithTenantAsync, tenantValues } from '$lib/db/tenant';
import { createField } from '$lib/db/fields';
import { createBlock } from '$lib/db/blocks';
import { createCutting } from '$lib/db/hayCuttings';
import { insertScoutObservation } from '$lib/db/scoutObservations';
import { listUnifiedRecords } from '$lib/db/recordsUnified';
import { DEFAULT_PREFS } from '$lib/prefs';
import { buildRecordCards, hayLateNotice } from './recordCards';

const DAY = 86_400_000;

function seed() {
  const ownerId = `late-cards-${randomUUID()}`;
  db.insert(owners)
    .values({ id: ownerId, name: ownerId, slug: ownerId, billingStatus: 'active' })
    .run();
  return runWithTenant(ownerId, () => {
    const field = createField({ name: 'Hay field' });
    const block = createBlock({ name: 'Hay 1', fieldId: field.id, acres: 2 });
    const cropId = `crop-${randomUUID()}`;
    db.insert(crops)
      .values(
        tenantValues({
          id: cropId,
          blockId: block.id,
          cropPluginId: 'alfalfa-vernema',
          varietyDisplayName: 'Vernema alfalfa',
          plantingDate: new Date(Date.now() - 300 * DAY),
          status: 'active' as const
        })
      )
      .run();
    const make = (mowAt: number) =>
      createCutting({
        blockId: block.id,
        cropId,
        cropPluginId: 'alfalfa-vernema',
        year: new Date(mowAt).getFullYear(),
        mowAt,
        rulesVersion: 'rv-test'
      });
    const late = make(Date.now() - 4 * DAY - 60_000);
    const onTime = make(Date.now() - 60_000);
    const scout = insertScoutObservation({
      blockId: block.id,
      performedById: 'late-cards-user',
      pest: 'leafhopper',
      metric: 'per_sweep',
      value: 2,
      occurredAt: Date.now() - 10 * DAY
    });
    return { ownerId, late, onTime, scoutId: scout.id };
  });
}

db.insert(users)
  .values({ id: 'late-cards-user', email: 'late-cards@test.local' })
  .onConflictDoNothing()
  .run();
const farm = seed();

describe('/records rows (G2-05)', () => {
  it('flag hay rows from the stored column and leave other kinds unset', () => {
    const rows = runWithTenant(farm.ownerId, () => listUnifiedRecords({}));
    expect(rows.find((r) => r.rowId === farm.late.id)).toMatchObject({
      kind: 'hay',
      recordedLate: true,
      daysLate: 4
    });
    expect(rows.find((r) => r.rowId === farm.onTime.id)).toMatchObject({
      recordedLate: false,
      daysLate: null
    });
    const scout = rows.find((r) => r.rowId === farm.scoutId);
    expect(scout?.recordedLate).toBeUndefined();
    expect(scout?.daysLate).toBeUndefined();
  });
});

describe('hay record card (G2-06)', () => {
  it('carries the line on a late cutting only', async () => {
    const late = await runWithTenantAsync(farm.ownerId, () =>
      buildRecordCards('hay', farm.late.id, { prefs: DEFAULT_PREFS })
    );
    expect(late!.cards.length).toBeGreaterThan(0);
    expect(late!.cards[0].notices).toContain('Hay cutting 1: Saved 4 days after its date.');

    const onTime = await runWithTenantAsync(farm.ownerId, () =>
      buildRecordCards('hay', farm.onTime.id, { prefs: DEFAULT_PREFS })
    );
    expect(onTime!.cards.length).toBeGreaterThan(0);
    expect(JSON.stringify(onTime)).not.toContain('after its date');
  });

  it('writes the line as a plain sentence', () => {
    expect(hayLateNotice(2, 'Saved late')).toBe('Hay cutting 2: Saved late.');
  });
});

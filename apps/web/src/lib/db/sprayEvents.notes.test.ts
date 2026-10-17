import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import { runWithTenant, tenantValues } from './tenant';
import { db } from './client';
import { equipment, owners, users } from './schema';
import { createField } from './fields';
import { createBlock } from './blocks';
import { getSprayEvent, insertSprayEvent, listSprayEvents } from './sprayEvents';
import { sprayDetail } from '$lib/records/recordDetail';
import { DEFAULT_PREFS } from '$lib/prefs';

const OWNER = 'spray-notes-owner';
const USER = 'u-spray-notes';

function seed(): { blockId: string; sprayerId: string } {
  db.insert(owners)
    .values({ id: OWNER, name: OWNER, slug: OWNER, billingStatus: 'active' })
    .onConflictDoNothing()
    .run();
  db.insert(users)
    .values({ id: USER, email: `${USER}@notes.test` })
    .onConflictDoNothing()
    .run();
  return runWithTenant(OWNER, () => {
    const field = createField({ name: `field-${randomUUID().slice(0, 6)}` });
    const block = createBlock({
      name: `block-${randomUUID().slice(0, 6)}`,
      fieldId: field.id,
      acres: 1
    });
    const sprayerId = `sprayer-${randomUUID().slice(0, 6)}`;
    db.insert(equipment)
      .values(tenantValues({ id: sprayerId, type: 'sprayer' as const, label: 'Sprayer' }))
      .run();
    return { blockId: block.id, sprayerId };
  });
}

function insert(notes?: string) {
  const { blockId, sprayerId } = seed();
  return runWithTenant(OWNER, () =>
    insertSprayEvent({
      blockId,
      sprayerId,
      performedById: USER,
      occurredAt: Date.now(),
      products: [{ pluginId: 'herb:test', chemistryClasses: ['glyphosate'] }],
      conditions: { windMph: 5, tempF: 70, rainForecastMmNext24h: 0 },
      rulesVersion: 'test',
      pluginHashes: { 'herb:test': 'abc' },
      notes
    })
  );
}

describe('spray_event notes', () => {
  it('round-trips notes through insert, get and list', () => {
    const text = 'Drift toward the east fence, stopped early';
    const inserted = insert(text);
    expect(inserted.notes).toBe(text);
    expect(runWithTenant(OWNER, () => getSprayEvent(inserted.id))?.notes).toBe(text);
    const listed = runWithTenant(OWNER, () => listSprayEvents({ blockId: inserted.blockId }));
    expect(listed.find((e) => e.id === inserted.id)?.notes).toBe(text);
  });

  it('stores blank or missing notes as none', () => {
    expect(insert('   ').notes).toBeUndefined();
    expect(insert().notes).toBeUndefined();
  });

  it('shows the stored notes on the /records detail', () => {
    const inserted = insert('Second pass on the low end');
    const ev = runWithTenant(OWNER, () => getSprayEvent(inserted.id));
    const view = sprayDetail(
      {
        blockLabel: 'Block',
        blockAcres: 1,
        sprayerLabel: null,
        products: [],
        conditions: null,
        notes: ev?.notes
      },
      DEFAULT_PREFS
    );
    expect(view.rows.some((r) => r.value === 'Second pass on the low end')).toBe(true);
  });
});

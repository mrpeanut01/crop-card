import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { db } from '$lib/db/client';
import { owners } from '$lib/db/schema';
import { runWithTenant, runWithTenantAsync } from '$lib/db/tenant';
import { getSetting } from '$lib/db/settings';
import { buildFarmMapCard } from '$lib/cards/build';
import { buildMapSnapshot } from '$lib/server/mapSnapshot';
import { buildFarmSnapshot, snapshotEtag } from '$lib/server/cardSnapshot';
import { EMERGENCY_CONTACTS_KEY, POISON_CONTROL_CONTACT } from './emergencyContacts';
import { loadEmergencyContacts, saveEmergencyContacts } from './emergencyContacts.server';

function newOwner(): string {
  const id = `ec-${randomUUID()}`;
  db.insert(owners)
    .values({ id, name: `Farm ${id}`, slug: id, billingStatus: 'active' })
    .run();
  return id;
}

const vet = { name: 'Dr. Reyes', role: 'Vet', phone: '540-555-0101' };

describe('emergency contacts setting', () => {
  it('round-trips and clears the setting when emptied', () => {
    const a = newOwner();
    runWithTenant(a, () => {
      expect(loadEmergencyContacts()).toEqual([]);
      saveEmergencyContacts([POISON_CONTROL_CONTACT, vet]);
      expect(loadEmergencyContacts()).toEqual([POISON_CONTROL_CONTACT, vet]);
      saveEmergencyContacts([]);
      expect(loadEmergencyContacts()).toEqual([]);
      expect(getSetting(EMERGENCY_CONTACTS_KEY)).toBeUndefined();
    });
  });

  it('refuses more than five contacts', () => {
    const a = newOwner();
    const six = Array.from({ length: 6 }, (_, i) => ({ ...vet, name: `Vet ${i}` }));
    expect(() => runWithTenant(a, () => saveEmergencyContacts(six))).toThrow();
  });

  it('keeps each Owner’s contacts to that Owner', () => {
    const a = newOwner();
    const b = newOwner();
    runWithTenant(a, () => saveEmergencyContacts([vet]));
    runWithTenant(b, () => saveEmergencyContacts([POISON_CONTROL_CONTACT]));
    expect(runWithTenant(a, () => loadEmergencyContacts())).toEqual([vet]);
    expect(runWithTenant(b, () => loadEmergencyContacts())).toEqual([POISON_CONTROL_CONTACT]);
    const c = newOwner();
    expect(runWithTenant(c, () => loadEmergencyContacts())).toEqual([]);
  });

  it('reaches the Farm Map Card through both snapshots', async () => {
    const a = newOwner();
    const b = newOwner();
    runWithTenant(a, () => saveEmergencyContacts([vet]));

    const mapSnap = runWithTenant(a, () => buildMapSnapshot());
    expect(mapSnap.emergencyContacts).toEqual([vet]);
    expect(buildFarmMapCard(mapSnap).sections[0]).toEqual({
      title: 'Emergency contacts',
      items: ['Dr. Reyes (Vet): 540-555-0101']
    });

    const before = await runWithTenantAsync(a, () => buildFarmSnapshot());
    expect(before.emergencyContacts).toEqual([vet]);
    runWithTenant(a, () => saveEmergencyContacts([vet, POISON_CONTROL_CONTACT]));
    const after = await runWithTenantAsync(a, () => buildFarmSnapshot());
    expect(snapshotEtag(after)).not.toBe(snapshotEtag(before));

    const other = await runWithTenantAsync(b, () => buildFarmSnapshot());
    expect(other.emergencyContacts).toEqual([]);
    expect(JSON.stringify(other)).not.toContain('Dr. Reyes');
  });
});

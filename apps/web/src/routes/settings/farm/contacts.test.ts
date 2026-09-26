import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { isHttpError, type RequestEvent } from '@sveltejs/kit';
import { db } from '$lib/db/client';
import { owners } from '$lib/db/schema';
import { runWithTenant, runWithTenantAsync } from '$lib/db/tenant';
import { ADD_POISON_CONTROL_INTENT, POISON_CONTROL_CONTACT } from '$lib/farm/emergencyContacts';
import { loadEmergencyContacts, saveEmergencyContacts } from '$lib/farm/emergencyContacts.server';
import { actions } from './+page.server';

function newOwner(): string {
  const id = `ecr-${randomUUID()}`;
  db.insert(owners)
    .values({ id, name: `Farm ${id}`, slug: id, billingStatus: 'active' })
    .run();
  return id;
}

type Row = { name: string; role: string; phone: string };

function formFor(rows: Row[], extra: Record<string, string> = {}): FormData {
  const fd = new FormData();
  fd.set('contactsPresent', '1');
  for (const r of rows) {
    fd.append('contactName', r.name);
    fd.append('contactRole', r.role);
    fd.append('contactPhone', r.phone);
  }
  for (const [k, v] of Object.entries(extra)) fd.set(k, v);
  return fd;
}

function event(ownerId: string, role: 'owner' | 'helper', body: FormData): RequestEvent {
  return {
    locals: { user: { id: 'u', role, activeOwnerId: ownerId } },
    request: new Request('http://localhost/settings/farm?/save', { method: 'POST', body })
  } as unknown as RequestEvent;
}

async function save(ownerId: string, body: FormData, role: 'owner' | 'helper' = 'owner') {
  return runWithTenantAsync(ownerId, async () => actions.save(event(ownerId, role, body)));
}

const vet = { name: 'Dr. Reyes', role: 'Vet', phone: '540-555-0101' };

describe('/settings/farm emergency contacts', () => {
  it('saves the typed contacts and skips blank rows', async () => {
    const a = newOwner();
    const r = await save(a, formFor([vet, { name: '', role: '', phone: '' }]));
    expect(r).toEqual({ ok: true });
    expect(runWithTenant(a, () => loadEmergencyContacts())).toEqual([vet]);
  });

  it('adds Poison Control in one tap without losing typed rows', async () => {
    const a = newOwner();
    await save(a, formFor([vet], { intent: ADD_POISON_CONTROL_INTENT }));
    expect(runWithTenant(a, () => loadEmergencyContacts())).toEqual([vet, POISON_CONTROL_CONTACT]);
    await save(a, formFor([vet, POISON_CONTROL_CONTACT], { intent: ADD_POISON_CONTROL_INTENT }));
    expect(runWithTenant(a, () => loadEmergencyContacts())).toHaveLength(2);
  });

  it('returns the rows with a message when one needs fixing', async () => {
    const a = newOwner();
    runWithTenant(a, () => saveEmergencyContacts([vet]));
    const bad = { name: 'Neighbor', role: '', phone: 'soon' };
    const r = (await save(a, formFor([vet, bad]))) as unknown as {
      status: number;
      data: { contactsError: string; contactRows: Row[] };
    };
    expect(r.status).toBe(400);
    expect(r.data.contactsError).toMatch(/^Contact 2:/);
    expect(r.data.contactRows).toEqual([vet, bad]);
    expect(runWithTenant(a, () => loadEmergencyContacts())).toEqual([vet]);
  });

  it('clears the list when every row is removed', async () => {
    const a = newOwner();
    runWithTenant(a, () => saveEmergencyContacts([vet]));
    await save(a, formFor([]));
    expect(runWithTenant(a, () => loadEmergencyContacts())).toEqual([]);
  });

  it('leaves contacts alone when the form did not carry the section', async () => {
    const a = newOwner();
    runWithTenant(a, () => saveEmergencyContacts([vet]));
    await save(a, new FormData());
    expect(runWithTenant(a, () => loadEmergencyContacts())).toEqual([vet]);
  });

  it('refuses a helper', async () => {
    const a = newOwner();
    let caught: unknown;
    try {
      await save(a, formFor([vet]), 'helper');
    } catch (e) {
      caught = e;
    }
    expect(isHttpError(caught) && caught.status).toBe(403);
    expect(runWithTenant(a, () => loadEmergencyContacts())).toEqual([]);
  });
});

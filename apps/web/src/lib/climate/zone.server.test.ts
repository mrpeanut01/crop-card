import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { db } from '$lib/db/client';
import { owners } from '$lib/db/schema';
import { runWithTenant, runWithTenantAsync } from '$lib/db/tenant';
import { getSetting, setSetting } from '$lib/db/settings';
import { SETTINGS_KEYS } from '$lib/schedule/constants';
import { loadHardinessZone, saveHardinessZoneChoice } from './zone.server';

function newOwner(): string {
  const id = `zone-${randomUUID()}`;
  db.insert(owners).values({ id, name: id, slug: id, billingStatus: 'active' }).run();
  return id;
}

const DULLES = JSON.stringify({ lat: 38.9408, lon: -77.4636 });

describe('loadHardinessZone', () => {
  it('estimates the zone from the saved farm location', async () => {
    const a = newOwner();
    runWithTenant(a, () => setSetting(SETTINGS_KEYS.farmLatLon, DULLES));
    const z = await runWithTenantAsync(a, () => loadHardinessZone());
    expect(z).toMatchObject({ label: '7a', provenance: 'data' });
    expect(z?.stationName).toMatch(/Dulles/);
  });

  it('is unknown without a saved location', async () => {
    const a = newOwner();
    expect(await runWithTenantAsync(a, () => loadHardinessZone())).toBeNull();
  });

  it('keeps one Owner’s override away from another', async () => {
    const a = newOwner();
    const b = newOwner();
    for (const o of [a, b]) runWithTenant(o, () => setSetting(SETTINGS_KEYS.farmLatLon, DULLES));
    runWithTenant(b, () =>
      expect(saveHardinessZoneChoice('6B')).toEqual({ ok: true, changed: true })
    );
    expect(await runWithTenantAsync(b, () => loadHardinessZone())).toMatchObject({
      label: '6b',
      provenance: 'manual',
      estimate: '7a'
    });
    expect(await runWithTenantAsync(a, () => loadHardinessZone())).toMatchObject({
      label: '7a',
      provenance: 'data'
    });
  });
});

describe('saveHardinessZoneChoice', () => {
  it('saves a zone as manual, ignores repeats and clears on blank', () => {
    const a = newOwner();
    runWithTenant(a, () => {
      expect(saveHardinessZoneChoice(null)).toEqual({ ok: true, changed: false });
      expect(saveHardinessZoneChoice('')).toEqual({ ok: true, changed: false });
      expect(saveHardinessZoneChoice('8a')).toEqual({ ok: true, changed: true });
      expect(getSetting(SETTINGS_KEYS.hardinessZone)).toBe('8a');
      expect(getSetting(SETTINGS_KEYS.hardinessZoneProvenance)).toBe('manual');
      expect(saveHardinessZoneChoice('8a')).toEqual({ ok: true, changed: false });
      expect(saveHardinessZoneChoice('  ')).toEqual({ ok: true, changed: true });
      expect(getSetting(SETTINGS_KEYS.hardinessZone)).toBeUndefined();
      expect(getSetting(SETTINGS_KEYS.hardinessZoneProvenance)).toBeUndefined();
    });
  });

  it('refuses something that is not a zone and leaves the setting alone', () => {
    const a = newOwner();
    runWithTenant(a, () => {
      saveHardinessZoneChoice('7b');
      const r = saveHardinessZoneChoice('zone 99');
      expect(r.ok).toBe(false);
      expect(getSetting(SETTINGS_KEYS.hardinessZone)).toBe('7b');
    });
  });
});

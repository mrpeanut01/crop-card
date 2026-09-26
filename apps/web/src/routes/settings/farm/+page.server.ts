/**
 * Phase 25c (#88) — /settings/farm loader.
 *
 * Farm-level configuration. Sprint 2 (#203) added a save action for the
 * farm display name; #309 wires the lat/lon + frost-date inputs so they
 * persist to the same app_settings keys the /api/settings endpoint uses
 * (farm_lat_lon / last_frost_date / first_frost_date) and round-trip on
 * reload.
 */

import { error, fail, redirect, type Actions, type ServerLoad } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { db } from '$lib/db/client';
import { owners } from '$lib/db/schema';
import { listBlocks } from '$lib/db/blocks';
import { listFields } from '$lib/db/fields';
import { getFarmLatLon, hasFarmLatLon } from '$lib/schedule/settings';
import { setSetting } from '$lib/db/settings';
import { SETTINGS_KEYS } from '$lib/schedule/constants';
import { parseLatLon } from '$lib/schedule/farmLocation';
import {
  applyFrostPlan,
  loadStoredFrost,
  resolveFrostForm
} from '$lib/climate/frostSettings.server';
import { storedFrostView } from '$lib/climate/frostSettings';
import { loadSeasonSetup } from '$lib/season/setup.server';
import { unscopedQueryNote } from '$lib/db/tenant';
import { loadHardinessZone, saveHardinessZoneChoice } from '$lib/climate/zone.server';
import { parseHardinessZone } from '$lib/climate/zone';
import {
  ADD_POISON_CONTROL_INTENT,
  contactRowsFromForm,
  parseContactRows,
  withPoisonControl
} from '$lib/farm/emergencyContacts';
import { loadEmergencyContacts, saveEmergencyContacts } from '$lib/farm/emergencyContacts.server';

export const load: ServerLoad = async ({ locals }) => {
  if (!locals.user) throw redirect(303, '/');
  if (locals.user.role !== 'owner') throw error(403, 'owner-only');

  const blocks = listBlocks();
  const fields = listFields();
  const fieldNameById = new Map(fields.map((f) => [f.id, f.name]));
  const currentYear = new Date().getFullYear();

  const blocksWithField = blocks.map((b) => ({
    id: b.id,
    name: b.name,
    acres: b.acres,
    blockLabel: b.blockLabel,
    fieldId: b.fieldId,
    fieldName: b.fieldId ? (fieldNameById.get(b.fieldId) ?? null) : null,
    plantingCount: b.plantings?.length ?? 0
  }));

  let farmName = '';
  if (locals.user.activeOwnerId) {
    const row = db
      .select({ name: owners.name })
      .from(owners)
      .where(eq(owners.id, locals.user.activeOwnerId))
      .get();
    farmName = row?.name ?? '';
  }

  return {
    farmName,
    blocks: blocksWithField,
    // Full geometry-bearing payloads for the read-only BlockMap preview.
    mapBlocks: blocks,
    mapFields: fields,
    fields: fields.map((f) => ({ id: f.id, name: f.name })),
    farmLatLon: hasFarmLatLon() ? getFarmLatLon() : null,
    frost: (() => {
      const stored = loadStoredFrost();
      return {
        values: storedFrostView(stored.dates, stored.provenance),
        source: stored.provenance.source,
        probability: stored.provenance.probability
      };
    })(),
    currentYear,
    activeSeasonSetup: loadSeasonSetup(currentYear),
    hardinessZone: await loadHardinessZone(),
    emergencyContacts: loadEmergencyContacts()
  };
};

export const actions: Actions = {
  save: async ({ request, locals }) => {
    if (!locals.user) throw error(401, 'sign-in required');
    if (locals.user.role !== 'owner') throw error(403, 'owner-only');
    if (!locals.user.activeOwnerId) throw error(400, 'no active owner');
    const form = await request.formData();
    const hasContacts = form.get('contactsPresent') === '1';
    let rows = contactRowsFromForm(form);
    if (form.get('intent') === ADD_POISON_CONTROL_INTENT) rows = withPoisonControl(rows);
    const contacts = hasContacts ? parseContactRows(rows) : null;
    if (contacts && !contacts.ok) {
      return fail(400, { contactsError: contacts.error, contactRows: rows });
    }

    const latLon = parseLatLon(form.get('lat'), form.get('lon'));
    const frost = await resolveFrostForm(form, latLon);
    if (!frost.ok) return fail(400, { error: frost.error, contactRows: rows });
    const zoneValue = form.get('hardinessZone');
    if (zoneValue !== null && String(zoneValue).trim() && !parseHardinessZone(zoneValue)) {
      return fail(400, {
        error: `"${String(zoneValue).trim()}" isn't a hardiness zone. Pick one like 7a.`,
        contactRows: rows
      });
    }

    const farmName = String(form.get('farmName') ?? '').trim();
    if (farmName.length > 0 && farmName.length <= 120) {
      unscopedQueryNote('settings/farm save updates the active owners row');
      db.update(owners)
        .set({ name: farmName })
        .where(eq(owners.id, locals.user.activeOwnerId))
        .run();
    }

    if (latLon) setSetting(SETTINGS_KEYS.farmLatLon, JSON.stringify(latLon));
    if (frost.plan) applyFrostPlan(frost.plan);
    saveHardinessZoneChoice(zoneValue);
    if (contacts?.ok) saveEmergencyContacts(contacts.contacts);

    return { ok: true };
  }
};

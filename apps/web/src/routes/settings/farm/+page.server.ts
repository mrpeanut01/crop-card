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
import { parseZone } from '$lib/climate/zone';
import { loadManualZone, saveZoneForm } from '$lib/climate/zoneSettings.server';
import { loadSeasonSetup } from '$lib/season/setup.server';
import { unscopedQueryNote } from '$lib/db/tenant';

export const load: ServerLoad = ({ locals }) => {
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
    manualZone: loadManualZone(),
    currentYear,
    activeSeasonSetup: loadSeasonSetup(currentYear)
  };
};

export const actions: Actions = {
  save: async ({ request, locals }) => {
    if (!locals.user) throw error(401, 'sign-in required');
    if (locals.user.role !== 'owner') throw error(403, 'owner-only');
    if (!locals.user.activeOwnerId) throw error(400, 'no active owner');
    const form = await request.formData();
    const latLon = parseLatLon(form.get('lat'), form.get('lon'));
    const frost = await resolveFrostForm(form, latLon);
    if (!frost.ok) return fail(400, { error: frost.error });
    const zoneRaw = form.get('hardinessZone');
    if (zoneRaw !== null && String(zoneRaw).trim() !== '' && !parseZone(zoneRaw)) {
      return fail(400, { error: 'Enter a zone like 7a or 6b, or leave it blank.' });
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
    saveZoneForm(zoneRaw);

    return { ok: true };
  }
};

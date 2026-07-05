/**
 * Phase 25c (#88) — /settings/farm loader.
 *
 * Farm-level configuration. Sprint 2 (#203) added a save action for the
 * farm display name; #309 wires the lat/lon + frost-date inputs so they
 * persist to the same app_settings keys the /api/settings endpoint uses
 * (farm_lat_lon / last_frost_date / first_frost_date) and round-trip on
 * reload.
 */

import { error, redirect, type Actions, type ServerLoad } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { db } from '$lib/db/client';
import { owners } from '$lib/db/schema';
import { listBlocks } from '$lib/db/blocks';
import { listFields } from '$lib/db/fields';
import { getFarmLatLon, frostDatesForYear } from '$lib/schedule/settings';
import { getSetting, setSetting } from '$lib/db/settings';
import { SETTINGS_KEYS } from '$lib/schedule/constants';
import { loadSeasonSetup } from '$lib/season/setup.server';
import { unscopedQueryNote } from '$lib/db/tenant';

const MM_DD_RE = /^(0?[1-9]|1[0-2])-(0?[1-9]|[12][0-9]|3[01])$/;

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
    farmLatLon: getFarmLatLon(),
    frostDates: frostDatesForYear(currentYear),
    // Raw MM-DD strings backing the editable frost inputs (null → default
    // shown to the user as an empty field with placeholder guidance).
    lastFrostMmDd: getSetting(SETTINGS_KEYS.lastFrost) ?? null,
    firstFrostMmDd: getSetting(SETTINGS_KEYS.firstFrost) ?? null,
    currentYear,
    activeSeasonSetup: loadSeasonSetup(currentYear)
  };
};

/** Normalize a frost-date form value to a canonical `MM-DD` string, or
 *  null when the field was left blank. Accepts both the browser
 *  `<input type="date">` shape (`YYYY-MM-DD`) and a bare `MM-DD`. */
function normalizeFrost(raw: string): string | null {
  const s = raw.trim();
  if (!s) return null;
  const iso = /^\d{4}-(\d{2})-(\d{2})$/.exec(s);
  const mmdd = iso ? `${iso[1]}-${iso[2]}` : s;
  return MM_DD_RE.test(mmdd) ? mmdd : null;
}

export const actions: Actions = {
  save: async ({ request, locals }) => {
    if (!locals.user) throw error(401, 'sign-in required');
    if (locals.user.role !== 'owner') throw error(403, 'owner-only');
    if (!locals.user.activeOwnerId) throw error(400, 'no active owner');
    const form = await request.formData();

    const farmName = String(form.get('farmName') ?? '').trim();
    if (farmName.length > 0 && farmName.length <= 120) {
      unscopedQueryNote('settings/farm save updates the active owners row');
      db.update(owners)
        .set({ name: farmName })
        .where(eq(owners.id, locals.user.activeOwnerId))
        .run();
    }

    // Lat/lon — persisted as JSON under farm_lat_lon (same key /api/settings
    // validates). Only write when both parse to in-range numbers.
    const latRaw = String(form.get('lat') ?? '').trim();
    const lonRaw = String(form.get('lon') ?? '').trim();
    if (latRaw && lonRaw) {
      const lat = Number(latRaw);
      const lon = Number(lonRaw);
      if (
        Number.isFinite(lat) &&
        Number.isFinite(lon) &&
        lat >= -90 &&
        lat <= 90 &&
        lon >= -180 &&
        lon <= 180
      ) {
        setSetting(SETTINGS_KEYS.farmLatLon, JSON.stringify({ lat, lon }));
      }
    }

    // Frost dates — MM-DD strings under last_frost_date / first_frost_date.
    const lastFrost = normalizeFrost(String(form.get('lastFrost') ?? ''));
    if (lastFrost) setSetting(SETTINGS_KEYS.lastFrost, lastFrost);
    const firstFrost = normalizeFrost(String(form.get('firstFrost') ?? ''));
    if (firstFrost) setSetting(SETTINGS_KEYS.firstFrost, firstFrost);

    return { ok: true };
  }
};

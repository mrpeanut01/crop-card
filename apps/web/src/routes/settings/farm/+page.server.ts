/**
 * Phase 25c (#88) — /settings/farm loader.
 *
 * Farm-level configuration. Sprint 2 (#203) adds a save action so the
 * Save button is no longer permanently disabled — for now it persists
 * the farm display name (the only field with a real backing column);
 * lat/lon + frost-date edits stay in /settings/system until that page
 * gets its own form.
 */

import { error, redirect, type Actions, type ServerLoad } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { db } from '$lib/db/client';
import { owners } from '$lib/db/schema';
import { listBlocks } from '$lib/db/blocks';
import { listFields } from '$lib/db/fields';
import { getFarmLatLon, frostDatesForYear } from '$lib/schedule/settings';
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
    farmLatLon: getFarmLatLon(),
    frostDates: frostDatesForYear(currentYear),
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
    const farmName = String(form.get('farmName') ?? '').trim();
    if (farmName.length > 0 && farmName.length <= 120) {
      unscopedQueryNote('settings/farm save updates the active owners row');
      db.update(owners)
        .set({ name: farmName })
        .where(eq(owners.id, locals.user.activeOwnerId))
        .run();
    }
    return { ok: true };
  }
};

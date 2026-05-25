/**
 * Phase 25c (#88) — /settings/farm loader.
 *
 * Farm-level configuration:
 *   - block list with field grouping (read-only here; CRUD on /plan)
 *   - active season setup (year + philosophy + fertility approach)
 *   - lat/lon + frost dates (read-only summary; edit at /settings/system
 *     Location & Climate tab until that gets its own form here)
 *
 * Folds /settings/season's data into the same page so the operator
 * doesn't have to hop between subroutes for adjacent farm config.
 */

import { error, redirect, type ServerLoad } from '@sveltejs/kit';
import { listBlocks } from '$lib/db/blocks';
import { listFields } from '$lib/db/fields';
import { getFarmLatLon, frostDatesForYear } from '$lib/schedule/settings';
import { loadSeasonSetup } from '$lib/season/setup.server';

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

  return {
    blocks: blocksWithField,
    fields: fields.map((f) => ({ id: f.id, name: f.name })),
    farmLatLon: getFarmLatLon(),
    frostDates: frostDatesForYear(currentYear),
    currentYear,
    activeSeasonSetup: loadSeasonSetup(currentYear)
  };
};

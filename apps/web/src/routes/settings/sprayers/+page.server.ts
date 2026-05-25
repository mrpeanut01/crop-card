/**
 * Phase 25c (#88) — /settings/sprayers loader.
 *
 * Sprayer roster + calibration status + contamination state. Surfaces
 * everything the operator needs to manage sprayer hygiene: which units
 * are calibrated (and to what GPA), which units carry residue requiring
 * decon before reuse, and links to the dedicated calibration / decon
 * flows.
 *
 * Replaces /equipment + /calibrate as the canonical entry points (those
 * routes redirect here in this commit; the dedicated flows remain at
 * /calibrate and /equipment/[id] for the workflow itself).
 */

import { error, redirect, type ServerLoad } from '@sveltejs/kit';
import { listEquipment } from '$lib/db/equipment';

export const load: ServerLoad = ({ locals }) => {
  if (!locals.user) throw redirect(303, '/');
  if (locals.user.role !== 'owner') throw error(403, 'owner-only');

  const equipment = listEquipment({ type: 'sprayer' });
  return {
    equipment: equipment.map((e) => ({
      id: e.id,
      type: e.type,
      label: e.label,
      calibratedGpa: e.state.calibratedGpa ?? null,
      calibrationDate: e.state.calibrationDate ?? null,
      lastChemistryClass: e.state.lastChemistryClass ?? null,
      lastUsedAt: e.state.lastUsedAt ?? null,
      requiresDecon:
        e.state.lastChemistryClass != null &&
        // Treat any prior synthetic-auxin / sulfonylurea use as decon-required
        // (the in-app decon wizard checks this too via the contamination map).
        ['synthetic-auxin', 'sulfonylurea', 'imidazolinone'].includes(e.state.lastChemistryClass)
    }))
  };
};

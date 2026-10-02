/**
 * Settings → Farm map. The standalone Fields & Blocks editing suite (Phase 27
 * follow-up). Geometry editing lives here, not in /plan?tab=layout (which is
 * now a read-only consumer). Owner-only — helpers manage inventory but not
 * field geometry.
 */

import { redirect, type ServerLoad } from '@sveltejs/kit';
import { listBlocks } from '$lib/db/blocks';
import { listFields } from '$lib/db/fields';
import { listShadeSources } from '$lib/db/shadeSources';
import { listMapFeatures } from '$lib/db/mapFeatures';
import { buildMapSnapshot } from '$lib/server/mapSnapshot';
import { withLiveCarryover } from '$lib/server/areaCarryover';
import { loadAreaHousing } from '$lib/server/areaHousing';
import { loadCoopSpecies } from '$lib/server/coopSpecies';
import { loadAreaGrazing } from '$lib/server/areaGrazing';
import { farmTimeZone } from '$lib/db/userProfile';
import { getFarmLatLon, hasFarmLatLon } from '$lib/schedule/settings';

export const load: ServerLoad = async ({ locals }) => {
  if (!locals.user) throw redirect(303, '/');
  if (locals.user.role !== 'owner') return { refused: true as const };

  const blocks = listBlocks();
  const fields = listFields();
  const { housing, petsLayout } = await loadAreaHousing(fields);
  const { coopSpecies, farmAnimals } = await loadCoopSpecies();
  const grazing = await loadAreaGrazing(blocks, farmTimeZone());
  return {
    refused: false as const,
    blocks,
    fields,
    ownerId: locals.user.activeOwnerId,
    snapshot: await withLiveCarryover(buildMapSnapshot({ fields, blocks })),
    shadeSources: listShadeSources(),
    mapFeatures: listMapFeatures(),
    housing,
    grazing,
    petsLayout,
    coopSpecies,
    farmAnimals,
    canEdit: true,
    isFirstRun: blocks.length === 0,
    initialCenter: hasFarmLatLon() ? getFarmLatLon() : null
  };
};

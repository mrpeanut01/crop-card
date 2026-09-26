import { redirect, type ServerLoad } from '@sveltejs/kit';
import { listBlocks } from '$lib/db/blocks';
import { listFields } from '$lib/db/fields';
import { listShadeSources } from '$lib/db/shadeSources';
import { listMapFeatures } from '$lib/db/mapFeatures';
import { buildMapSnapshot } from '$lib/server/mapSnapshot';
import { getFarmLatLon, hasFarmLatLon } from '$lib/schedule/settings';
import { getActivePlanningYear } from '$lib/season/planningYear.server';

export const load: ServerLoad = ({ locals, url }) => {
  if (!locals.user) throw redirect(303, '/');
  if (locals.user.role !== 'owner') throw redirect(303, '/plan');

  const blocks = listBlocks();
  const fields = listFields();
  return {
    blocks,
    fields,
    ownerId: locals.user.activeOwnerId,
    snapshot: buildMapSnapshot({ fields, blocks }),
    shadeSources: listShadeSources(),
    mapFeatures: listMapFeatures(),
    isFirstRun: blocks.length === 0 && fields.length === 0,
    seasonYear: getActivePlanningYear(),
    center: hasFarmLatLon() ? getFarmLatLon() : null,
    initialMode: url.searchParams.get('mode') === 'sketch' ? ('sketch' as const) : undefined
  };
};

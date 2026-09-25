import { redirect, type ServerLoad } from '@sveltejs/kit';
import { listBlocks } from '$lib/db/blocks';
import { listFields } from '$lib/db/fields';
import { listShadeSources } from '$lib/db/shadeSources';
import { getActivePlanningYear } from '$lib/season/planningYear.server';

export const load: ServerLoad = ({ locals }) => {
  if (!locals.user) throw redirect(303, '/');
  if (locals.user.role !== 'owner') throw redirect(303, '/plan');

  const blocks = listBlocks();
  const fields = listFields();
  return {
    blocks,
    fields,
    shadeSources: listShadeSources(),
    isFirstRun: blocks.length === 0 && fields.length === 0,
    seasonYear: getActivePlanningYear()
  };
};

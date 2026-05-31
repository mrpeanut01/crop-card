/**
 * Settings → Farm map. The standalone Fields & Blocks editing suite (Phase 27
 * follow-up). Geometry editing lives here, not in /plan?tab=layout (which is
 * now a read-only consumer). Owner-only — helpers manage inventory but not
 * field geometry.
 */

import { error, redirect, type ServerLoad } from '@sveltejs/kit';
import { listBlocks } from '$lib/db/blocks';
import { listFields } from '$lib/db/fields';
import { listShadeSources } from '$lib/db/shadeSources';

export const load: ServerLoad = ({ locals }) => {
  if (!locals.user) throw redirect(303, '/');
  if (locals.user.role !== 'owner') throw error(403, 'owner-only');

  const blocks = listBlocks();
  return {
    blocks,
    fields: listFields(),
    shadeSources: listShadeSources(),
    canEdit: true,
    isFirstRun: blocks.length === 0
  };
};

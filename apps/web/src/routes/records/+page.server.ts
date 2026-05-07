import type { PageServerLoad } from './$types';
import { listBlocks } from '$lib/db/blocks';
import { evaluateLock, listSprayEvents, recordsApproachingRetention } from '$lib/db/sprayEvents';
import { listSprayers } from '$lib/server/sprayers';

export const load: PageServerLoad = async ({ url }) => {
  const sprayerId = url.searchParams.get('sprayerId') ?? undefined;
  const blockId = url.searchParams.get('blockId') ?? undefined;

  const events = listSprayEvents({ limit: 200, sprayerId, blockId });
  const approaching = recordsApproachingRetention();

  return {
    records: events.map((e) => ({
      ...e,
      locked: evaluateLock(e) !== undefined
    })),
    approachingRetention: approaching.map((e) => e.id),
    sprayers: listSprayers(),
    blocks: listBlocks(),
    activeSprayerId: sprayerId ?? null,
    activeBlockId: blockId ?? null
  };
};

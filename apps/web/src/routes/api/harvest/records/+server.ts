import { json, type RequestHandler } from '@sveltejs/kit';
import { listHarvestEvents } from '$lib/db/harvestEvents';

export const GET: RequestHandler = ({ url }) => {
  const events = listHarvestEvents({
    blockId: url.searchParams.get('blockId') ?? undefined,
    cropPluginId: url.searchParams.get('cropPluginId') ?? undefined
  });
  return json({ records: events });
};

import { json, type RequestHandler } from '@sveltejs/kit';
import { listSprayers } from '$lib/server/sprayers';

export const GET: RequestHandler = () => {
  return json({ sprayers: listSprayers() });
};

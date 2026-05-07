import { json, type RequestHandler } from '@sveltejs/kit';
import { getEquipment, listEquipmentLog } from '$lib/db/equipment';

export const GET: RequestHandler = ({ params, url }) => {
  if (!params.id) return json({ error: 'id required' }, { status: 400 });
  const equipment = getEquipment(params.id);
  if (!equipment) return json({ error: 'not found' }, { status: 404 });
  const logLimit = Number(url.searchParams.get('logLimit') ?? '50');
  const log = listEquipmentLog(params.id, { limit: logLimit });
  return json({ equipment, log });
};

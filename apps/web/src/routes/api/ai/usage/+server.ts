import { json, type RequestHandler } from '@sveltejs/kit';
import { requireUser } from '$lib/server/auth';
import { spendSnapshot } from '$lib/server/aiGuard';
import { getApiKey } from '$lib/server/scanResult';

export const GET: RequestHandler = (event) => {
  const user = requireUser(event);
  return json(
    {
      usage: spendSnapshot(),
      isOwner: user.role === 'owner',
      aiAvailable: !!getApiKey()
    },
    { headers: { 'cache-control': 'no-store' } }
  );
};

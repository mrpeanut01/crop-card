import type { PageServerLoad } from './$types';
import { requireAdmin } from '$lib/server/auth';
import { listAudit } from '$lib/server/audit';

export const load: PageServerLoad = async (event) => {
  requireAdmin(event);
  const limitParam = Number(event.url.searchParams.get('limit') ?? '100');
  const limit = Number.isFinite(limitParam) ? Math.min(Math.max(limitParam, 1), 500) : 100;
  return { events: listAudit(limit), limit };
};

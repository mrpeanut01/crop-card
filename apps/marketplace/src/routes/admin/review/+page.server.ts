import { fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { requireAdmin } from '$lib/server/auth';
import { approveVersion, listPendingVersions, rejectVersion } from '$lib/server/review';

export const load: PageServerLoad = async (event) => {
  requireAdmin(event);
  return { pending: listPendingVersions() };
};

export const actions: Actions = {
  approve: async (event) => {
    const admin = requireAdmin(event);
    const data = await event.request.formData();
    const versionId = String(data.get('versionId') ?? '');
    const notes = String(data.get('notes') ?? '').trim() || undefined;
    if (!versionId) return fail(400, { error: 'versionId required' });
    const result = approveVersion({ versionId, adminUserId: admin.adminUserId, notes });
    if (!result.ok) return fail(400, { error: result.reason ?? 'failed' });
    return { approved: versionId };
  },
  reject: async (event) => {
    const admin = requireAdmin(event);
    const data = await event.request.formData();
    const versionId = String(data.get('versionId') ?? '');
    const notes = String(data.get('notes') ?? '').trim();
    if (!versionId) return fail(400, { error: 'versionId required' });
    if (!notes) return fail(400, { error: 'reject requires a note' });
    const result = rejectVersion({ versionId, adminUserId: admin.adminUserId, notes });
    if (!result.ok) return fail(400, { error: result.reason ?? 'failed' });
    return { rejected: versionId };
  }
};

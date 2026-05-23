import { fail, redirect, type Actions } from '@sveltejs/kit';
import { requireSuperadmin } from '$lib/server/auth';
import { listAllOwners, listAudit, setBillingStatus, writeAuditRow } from '$lib/server/superadmin';
import { activeAssignmentsForUser } from '$lib/db/users';
import { writeSession } from '$lib/server/session';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = (event) => {
  requireSuperadmin(event);
  return {
    owners: listAllOwners(),
    audit: listAudit(50)
  };
};

export const actions: Actions = {
  setBilling: async (event) => {
    const u = requireSuperadmin(event);
    const fd = await event.request.formData();
    const ownerId = String(fd.get('ownerId') ?? '');
    const status = String(fd.get('status') ?? '');
    if (!ownerId || !status) return fail(400, { error: 'ownerId + status required' });
    const allowed = ['trial', 'active', 'past_due', 'canceled', 'suspended'] as const;
    if (!(allowed as readonly string[]).includes(status)) {
      return fail(400, { error: 'invalid status' });
    }
    setBillingStatus(ownerId, status as (typeof allowed)[number], u.id);
    return { ok: true };
  },
  impersonate: async (event) => {
    const u = requireSuperadmin(event);
    const fd = await event.request.formData();
    const ownerId = String(fd.get('ownerId') ?? '');
    if (!ownerId) return fail(400, { error: 'ownerId required' });

    // The superadmin "borrows" the chosen Owner's tenant for this session.
    // The session cookie's `impersonating=true` flag surfaces the red
    // banner in the layout; every mutation downstream writes a
    // superadmin_audit row.
    writeAuditRow({
      superadminUserId: u.id,
      action: 'impersonate',
      ownerId,
      payload: { from: u.activeOwnerId }
    });
    writeSession(event.cookies, {
      id: u.id,
      email: u.email,
      isSuperadmin: true,
      activeOwnerId: ownerId,
      activeRole: 'owner',
      impersonating: true
    });
    throw redirect(303, '/today');
  },
  exitImpersonation: async (event) => {
    const u = requireSuperadmin(event);
    // Drop back to the superadmin's own first assignment (or partial
    // session if they have none).
    const assignments = activeAssignmentsForUser(u.id);
    const next = assignments[0] ?? null;
    writeSession(event.cookies, {
      id: u.id,
      email: u.email,
      isSuperadmin: true,
      activeOwnerId: next?.ownerId ?? null,
      activeRole: next?.roleWithinOwner ?? 'owner',
      impersonating: false
    });
    writeAuditRow({
      superadminUserId: u.id,
      action: 'exit_impersonation',
      ownerId: null
    });
    throw redirect(303, '/admin/owners');
  }
};

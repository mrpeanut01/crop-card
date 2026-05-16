import { error, json, type RequestHandler } from '@sveltejs/kit';
import { requireOwner } from '$lib/server/auth';
import { dispatchEmail } from '$lib/server/email';
import { issueInvite, listInvitesForOwner, revokeInvite } from '$lib/server/invites';
import { db } from '$lib/db/client';
import { owners } from '$lib/db/schema';
import { eq } from 'drizzle-orm';
import { unscopedQueryNote } from '$lib/db/tenant';

/** GET /api/invites — list invites for the active Owner. */
export const GET: RequestHandler = (event) => {
  const u = requireOwner(event);
  if (!u.activeOwnerId) throw error(400, 'no active owner');
  return json({ invites: listInvitesForOwner(u.activeOwnerId) });
};

/** POST /api/invites — issue a new invite. Body: `{ email, role, message? }`. */
export const POST: RequestHandler = async (event) => {
  const u = requireOwner(event);
  if (!u.activeOwnerId) throw error(400, 'no active owner');

  const body = await event.request.json().catch(() => null);
  if (!body || typeof body !== 'object') throw error(400, 'invalid body');
  const inviteeEmail = String(body.email ?? '').trim();
  const role = String(body.role ?? 'helper');
  const message = body.message ? String(body.message) : undefined;
  if (!inviteeEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(inviteeEmail)) {
    throw error(400, 'invalid email');
  }
  if (!['helper', 'inspector', 'custom-operator'].includes(role)) {
    throw error(400, 'invalid role');
  }

  const issued = issueInvite({
    ownerId: u.activeOwnerId,
    inviteeEmail,
    roleWithinOwner: role as 'helper' | 'inspector' | 'custom-operator',
    invitedByUserId: u.id
  });

  unscopedQueryNote('owner lookup for outbound email subject line');
  const ownerRow = db
    .select({ name: owners.name })
    .from(owners)
    .where(eq(owners.id, u.activeOwnerId))
    .get();
  const acceptUrl = `${event.url.origin}/invite/${issued.token}`;
  await dispatchEmail({
    kind: 'helper-invite',
    to: inviteeEmail,
    ownerName: ownerRow?.name ?? 'a CropCard farm',
    acceptUrl,
    message,
    expiresAt: issued.expiresAt
  });

  return json({
    ok: true,
    inviteId: issued.id,
    // The plaintext token is included in the response so the owner can
    // copy the link manually if email delivery fails. Treat as one-time.
    acceptUrl,
    expiresAt: issued.expiresAt
  });
};

/** DELETE /api/invites?id=<inviteId> — revoke an outstanding invite. */
export const DELETE: RequestHandler = (event) => {
  const u = requireOwner(event);
  if (!u.activeOwnerId) throw error(400, 'no active owner');
  const inviteId = event.url.searchParams.get('id');
  if (!inviteId) throw error(400, 'id required');
  const ok = revokeInvite(u.activeOwnerId, inviteId);
  if (!ok) throw error(404, 'invite not found');
  return json({ ok: true });
};

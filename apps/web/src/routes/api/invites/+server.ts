import { error, json, type RequestHandler } from '@sveltejs/kit';
import { requireOwner } from '$lib/server/auth';
import { dispatchEmail } from '$lib/server/email';
import { t } from '$lib/i18n';
import { localeField } from '$lib/server/messageLocale';
import { issueInvite, listInvitesForOwner, revokeInvite } from '$lib/server/invites';
import { roleTakesSeat, seatUsage, SEAT_LIMIT_MESSAGE } from '$lib/server/billing/plans';
import { db } from '$lib/db/client';
import { owners } from '$lib/db/schema';
import { eq } from 'drizzle-orm';
import { unscopedQueryNote } from '$lib/db/tenant';

/** GET /api/invites — list invites for the active Owner. */
export const GET: RequestHandler = (event) => {
  const u = requireOwner(event);
  if (!u.activeOwnerId) throw error(400, t(event.locals?.locale, 'api.errB.noActiveOwner'));
  return json({ invites: listInvitesForOwner(u.activeOwnerId) });
};

/** POST /api/invites — issue a new invite. Body: `{ email, role, message? }`. */
export const POST: RequestHandler = async (event) => {
  const u = requireOwner(event);
  if (!u.activeOwnerId) throw error(400, t(event.locals?.locale, 'api.errB.noActiveOwner'));

  const body = await event.request.json().catch(() => null);
  if (!body || typeof body !== 'object')
    throw error(400, t(event.locals?.locale, 'api.errB.invalidBody'));
  const inviteeEmail = String(body.email ?? '').trim();
  const role = String(body.role ?? 'helper');
  const message = body.message ? String(body.message) : undefined;
  if (!inviteeEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(inviteeEmail)) {
    throw error(400, t(event.locals?.locale, 'api.errB.invalidEmail'));
  }
  if (!['helper', 'inspector', 'custom-operator'].includes(role)) {
    throw error(400, t(event.locals?.locale, 'api.errB.invalidRole'));
  }

  if (roleTakesSeat(role)) {
    const seats = seatUsage(u.activeOwnerId);
    if (!seats.canInvite) {
      return json(
        {
          error: 'seat-limit',
          message: SEAT_LIMIT_MESSAGE,
          used: seats.used,
          limit: seats.limit,
          plan: seats.plan
        },
        { status: 409 }
      );
    }
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
  const emailSent = await dispatchEmail({
    kind: 'helper-invite',
    to: inviteeEmail,
    ownerName: ownerRow?.name ?? t(event.locals.locale, 'email.invite.ownerFallback'),
    acceptUrl,
    message,
    expiresAt: issued.expiresAt,
    ...localeField(event.locals.locale)
  }).then(
    () => true,
    (err) => {
      console.error('[invites] email dispatch failed; invite link still valid', err);
      return false;
    }
  );

  return json({
    ok: true,
    emailSent,
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
  if (!u.activeOwnerId) throw error(400, t(event.locals?.locale, 'api.errB.noActiveOwner'));
  const inviteId = event.url.searchParams.get('id');
  if (!inviteId) throw error(400, t(event.locals?.locale, 'stockui.api.idRequired'));
  const ok = revokeInvite(u.activeOwnerId, inviteId);
  if (!ok) throw error(404, t(event.locals?.locale, 'api.errB.inviteNotFound'));
  return json({ ok: true });
};

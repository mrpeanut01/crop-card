/**
 * POST /api/auth/token — mint a new owner-scoped Bearer token. Returns the
 *                        plaintext ONCE; UI is responsible for the copy-once
 *                        modal. Owner role required (helpers cannot mint).
 *
 * GET  /api/auth/token  — list the active Owner's tokens (no plaintext;
 *                        the DB doesn't have it). Useful for the settings UI
 *                        and for an agent to confirm its own existence.
 *
 * Phase 24 / UC-43.
 */

import { error, json, type RequestHandler } from '@sveltejs/kit';
import { requireOwner } from '$lib/server/auth';
import { issueToken, listTokensForOwner } from '$lib/server/apiTokens';

export const requestSchema = undefined; // see below — declared inline; Sub-task C will lift

export const GET: RequestHandler = (event) => {
  const u = requireOwner(event);
  if (!u.activeOwnerId) throw error(400, 'no active owner');
  // Bearer-authed tokens can list, but only their own tenant's tokens — the
  // requireOwner check above already runs the request inside that tenant.
  return json({ tokens: listTokensForOwner(u.activeOwnerId) });
};

export const POST: RequestHandler = async (event) => {
  const u = requireOwner(event);
  if (!u.activeOwnerId) throw error(400, 'no active owner');

  // Bearer-authed requests cannot mint NEW tokens — that would let a leaked
  // agent token bootstrap a longer-lived one. The mint surface is cookie-
  // session-only.
  if (event.locals.authVia === 'bearer') {
    throw error(403, 'minting new tokens requires a cookie session');
  }

  const body = await event.request.json().catch(() => null);
  if (!body || typeof body !== 'object') throw error(400, 'invalid body');
  const label = String(body.label ?? '').trim();
  const isServiceAccount = body.isServiceAccount === true;
  if (!label || label.length > 64) {
    throw error(400, 'label required (max 64 chars)');
  }

  const issued = issueToken({
    ownerId: u.activeOwnerId,
    userId: u.id,
    label,
    isServiceAccount
  });

  // Plaintext returned ONCE. The UI surfaces a copy-once modal; the DB never
  // sees plaintext (only sha256(plaintext)).
  return json(
    {
      id: issued.id,
      token: issued.token,
      label,
      isServiceAccount,
      createdAt: issued.createdAt
    },
    { status: 201 }
  );
};

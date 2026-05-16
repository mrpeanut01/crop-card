/**
 * Helper-invite issuance + redemption (Phase 18e).
 *
 * Tokens are random 32-byte values base64url-encoded. Only their SHA-256
 * hash is stored, so a DB compromise doesn't leak active invite URLs.
 * Email addresses are also hashed for lookup; the inviter sees the
 * plaintext address they typed but the row only holds the hash.
 *
 * The invite_lookup path (used on redemption) requires the helper to
 * arrive at `/invite/<token>` while authenticated under the matching
 * email — that's the second factor that binds the token to a real
 * identity. The hashes ensure no one can fish tokens from a DB dump.
 */

import { createHash, randomBytes } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { db } from '$lib/db/client';
import { helperInvites } from '$lib/db/schema';
import { unscopedQueryNote } from '$lib/db/tenant';

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export type InviteRoleWithinOwner = 'helper' | 'inspector' | 'custom-operator';

export interface IssuedInvite {
  id: string;
  token: string;
  expiresAt: number;
}

function sha256(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function hashEmail(email: string): string {
  return sha256(normalizeEmail(email));
}

export function hashToken(token: string): string {
  return sha256(token);
}

export function generateToken(): string {
  return randomBytes(32).toString('base64url');
}

export function issueInvite(input: {
  ownerId: string;
  inviteeEmail: string;
  roleWithinOwner: InviteRoleWithinOwner;
  invitedByUserId: string;
}): IssuedInvite {
  unscopedQueryNote('helper invite is keyed by ownerId + email_hash, scope is the Owner the inviter selected');
  const id = `inv_${Date.now()}_${randomBytes(4).toString('hex')}`;
  const token = generateToken();
  const now = Date.now();
  db.insert(helperInvites)
    .values({
      id,
      ownerId: input.ownerId,
      emailHash: hashEmail(input.inviteeEmail),
      tokenHash: hashToken(token),
      roleWithinOwner: input.roleWithinOwner,
      invitedByUserId: input.invitedByUserId,
      expiresAt: new Date(now + INVITE_TTL_MS),
      status: 'pending',
      createdAt: new Date(now)
    })
    .run();
  return { id, token, expiresAt: now + INVITE_TTL_MS };
}

export interface InviteSummary {
  id: string;
  ownerId: string;
  roleWithinOwner: InviteRoleWithinOwner;
  expiresAt: number;
  acceptedAt?: number;
  status: 'pending' | 'accepted' | 'revoked' | 'expired';
  createdAt: number;
}

export function listInvitesForOwner(ownerId: string): InviteSummary[] {
  unscopedQueryNote('owner-admin endpoint already gates by role; this lists their tenant only');
  return db
    .select()
    .from(helperInvites)
    .where(eq(helperInvites.ownerId, ownerId))
    .all()
    .map((r) => ({
      id: r.id,
      ownerId: r.ownerId,
      roleWithinOwner: r.roleWithinOwner,
      expiresAt: r.expiresAt.getTime(),
      acceptedAt: r.acceptedAt?.getTime(),
      status: r.status,
      createdAt: r.createdAt.getTime()
    }));
}

export function revokeInvite(ownerId: string, inviteId: string): boolean {
  unscopedQueryNote('revoke uses composite (owner_id, id) so caller cannot revoke cross-tenant');
  const r = db
    .update(helperInvites)
    .set({ status: 'revoked' })
    .where(and(eq(helperInvites.ownerId, ownerId), eq(helperInvites.id, inviteId)))
    .run();
  return r.changes > 0;
}

export interface InviteMatch {
  id: string;
  ownerId: string;
  roleWithinOwner: InviteRoleWithinOwner;
  expiresAt: number;
}

/** Find a pending, non-expired invite that matches the given token AND
 *  email. Both bindings are required: token verifies the URL came from
 *  the email, email-match verifies the recipient is who we sent it to. */
export function findRedeemableInvite(token: string, email: string): InviteMatch | null {
  unscopedQueryNote('invite redemption lookup is cross-tenant by definition');
  const tokenH = hashToken(token);
  const emailH = hashEmail(email);
  const row = db
    .select()
    .from(helperInvites)
    .where(and(eq(helperInvites.tokenHash, tokenH), eq(helperInvites.emailHash, emailH)))
    .get();
  if (!row) return null;
  if (row.status !== 'pending') return null;
  if (row.expiresAt.getTime() < Date.now()) return null;
  return {
    id: row.id,
    ownerId: row.ownerId,
    roleWithinOwner: row.roleWithinOwner,
    expiresAt: row.expiresAt.getTime()
  };
}

export function markInviteAccepted(inviteId: string): void {
  unscopedQueryNote('stamp accepted_at on the redeemed invite row');
  db.update(helperInvites)
    .set({ status: 'accepted', acceptedAt: new Date(Date.now()) })
    .where(eq(helperInvites.id, inviteId))
    .run();
}

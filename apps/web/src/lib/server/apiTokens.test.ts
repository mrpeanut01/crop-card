/**
 * apiTokens.ts unit tests (Phase 24, UC-43).
 *
 * Verifies the Bearer-token primitives: issue / lookup / revoke / touch.
 * Tenant isolation is exercised separately in apiTokens.crossTenant.test.ts.
 */

import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import {
  generatePlaintext,
  hashToken,
  issueToken,
  listTokensForOwner,
  lookupByPlaintext,
  revokeToken
} from './apiTokens';
import { db } from '$lib/db/client';
import { apiTokens, owners, users, helperAssignments } from '$lib/db/schema';

function uniq(prefix: string): string {
  return `${prefix}-${randomUUID().slice(0, 8)}`;
}

function seedOwnerAndUser(): { ownerId: string; userId: string } {
  const ownerId = uniq('owner');
  const userId = uniq('user');
  db.insert(owners).values({ id: ownerId, name: ownerId, slug: ownerId }).run();
  db.insert(users).values({ id: userId, email: `${userId}@example.test`, role: 'owner' }).run();
  db.insert(helperAssignments)
    .values({
      ownerId,
      userId,
      roleWithinOwner: 'owner',
      status: 'active'
    })
    .run();
  return { ownerId, userId };
}

describe('generatePlaintext', () => {
  it('emits a cck_ prefix + 43-char base64url body (32 bytes)', () => {
    const t = generatePlaintext();
    expect(t.startsWith('cck_')).toBe(true);
    // base64url of 32 bytes is 43 chars (no padding).
    expect(t.length).toBe(4 + 43);
    expect(t).toMatch(/^cck_[A-Za-z0-9_-]+$/);
  });

  it('never collides over 200 mints', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 200; i++) seen.add(generatePlaintext());
    expect(seen.size).toBe(200);
  });
});

describe('issueToken + lookupByPlaintext round-trip', () => {
  it('persists the SHA-256 hash, not the plaintext, and resolves the tenant tuple', () => {
    const { ownerId, userId } = seedOwnerAndUser();
    const { id, token } = issueToken({ ownerId, userId, label: 'test' });

    // DB row carries the hash, never the plaintext.
    const row = db.select().from(apiTokens).where(eq(apiTokens.id, id)).get();
    expect(row).toBeDefined();
    expect(row?.tokenHash).toBe(hashToken(token));
    expect(row?.tokenHash).not.toContain(token);

    const resolved = lookupByPlaintext(token);
    expect(resolved).toEqual({
      tokenId: id,
      ownerId,
      userId,
      isServiceAccount: false
    });
  });

  it('honors isServiceAccount on the resolved tuple', () => {
    const { ownerId, userId } = seedOwnerAndUser();
    const { token } = issueToken({ ownerId, userId, label: 'svc', isServiceAccount: true });
    expect(lookupByPlaintext(token)?.isServiceAccount).toBe(true);
  });
});

describe('lookupByPlaintext negative paths', () => {
  it('returns null for tokens without the cck_ prefix', () => {
    expect(lookupByPlaintext('ccm_definitely_not_ours')).toBeNull();
    expect(lookupByPlaintext('Bearer cck_something')).toBeNull();
    expect(lookupByPlaintext('')).toBeNull();
  });

  it('returns null for a well-formed but unknown token', () => {
    expect(lookupByPlaintext('cck_' + 'a'.repeat(43))).toBeNull();
  });

  it('returns null for a revoked token', () => {
    const { ownerId, userId } = seedOwnerAndUser();
    const { id, token } = issueToken({ ownerId, userId, label: 'doomed' });
    expect(lookupByPlaintext(token)).not.toBeNull();
    revokeToken(ownerId, id);
    expect(lookupByPlaintext(token)).toBeNull();
  });
});

describe('revokeToken is owner-scoped', () => {
  it('refuses to revoke another Owner\'s token', () => {
    const a = seedOwnerAndUser();
    const b = seedOwnerAndUser();
    const issuedForA = issueToken({ ownerId: a.ownerId, userId: a.userId, label: 'a-token' });

    // Owner B tries to revoke Owner A's token by guessing the id.
    const ok = revokeToken(b.ownerId, issuedForA.id);
    expect(ok).toBe(false);

    // Token still resolves — A's row was untouched.
    expect(lookupByPlaintext(issuedForA.token)).not.toBeNull();
  });

  it('returns true and dead-ends the token when the same owner revokes', () => {
    const { ownerId, userId } = seedOwnerAndUser();
    const { id, token } = issueToken({ ownerId, userId, label: 'real-revoke' });
    expect(revokeToken(ownerId, id)).toBe(true);
    expect(lookupByPlaintext(token)).toBeNull();
  });
});

describe('listTokensForOwner is tenant-scoped', () => {
  it('returns only the calling Owner\'s tokens, never anyone else\'s', () => {
    const a = seedOwnerAndUser();
    const b = seedOwnerAndUser();
    issueToken({ ownerId: a.ownerId, userId: a.userId, label: 'a-1' });
    issueToken({ ownerId: a.ownerId, userId: a.userId, label: 'a-2' });
    issueToken({ ownerId: b.ownerId, userId: b.userId, label: 'b-1' });

    const aTokens = listTokensForOwner(a.ownerId);
    const bTokens = listTokensForOwner(b.ownerId);

    expect(aTokens.map((t) => t.label).sort()).toEqual(['a-1', 'a-2']);
    expect(bTokens.map((t) => t.label).sort()).toEqual(['b-1']);
    // None of A's rows can possibly appear in B's list and vice-versa.
    for (const t of aTokens) expect(t.ownerId).toBe(a.ownerId);
    for (const t of bTokens) expect(t.ownerId).toBe(b.ownerId);
  });

  it('omits plaintext from summary rows', () => {
    const { ownerId, userId } = seedOwnerAndUser();
    const { token } = issueToken({ ownerId, userId, label: 'no-plaintext' });
    const summary = listTokensForOwner(ownerId)[0];
    // The plaintext is not on the summary shape at compile-time; runtime
    // check that nothing about the row leaks it.
    const json = JSON.stringify(summary);
    expect(json).not.toContain(token);
    expect(json).not.toContain(token.slice(4)); // body without prefix
  });
});

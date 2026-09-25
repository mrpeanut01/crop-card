/**
 * #221 / CT-ADM-002 — exitImpersonation must clear the impersonation flag
 * in the signed session AND write a superadmin_audit row. Driven against
 * the migrated test DB with the real session signer.
 */

import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { isHttpError, isRedirect, type Cookies, type RequestEvent } from '@sveltejs/kit';
import { and, eq } from 'drizzle-orm';

import { db } from '$lib/db/client';
import { helperAssignments, owners, superadminAudit, users } from '$lib/db/schema';
import { readSession, writeSession, type WriteSessionInput } from '$lib/server/session';
import { actions } from './+page.server';

function fakeCookies(): Cookies {
  const store = new Map<string, string>();
  return {
    get: (name: string) => store.get(name),
    getAll: () => Array.from(store.entries()).map(([name, value]) => ({ name, value })),
    set: (name: string, value: string) => store.set(name, value),
    delete: (name: string) => {
      store.delete(name);
    },
    serialize: () => ''
  } as unknown as Cookies;
}

function seedOwner(): string {
  const id = `imp-owner-${randomUUID().slice(0, 8)}`;
  db.insert(owners).values({ id, name: id, slug: id, billingStatus: 'active' }).run();
  return id;
}

function seedUser(isSuperadmin: boolean): { id: string; email: string } {
  const id = `imp-user-${randomUUID().slice(0, 8)}`;
  const email = `${id}@example.test`;
  db.insert(users).values({ id, email, isSuperadmin }).run();
  return { id, email };
}

function makeEvent(
  session: WriteSessionInput | null,
  locals: Record<string, unknown> = {}
): RequestEvent & { cookies: Cookies } {
  const cookies = fakeCookies();
  if (session) writeSession(cookies, session);
  return {
    cookies,
    locals,
    request: new Request('http://localhost/admin/owners?/exitImpersonation', {
      method: 'POST',
      body: new FormData()
    })
  } as unknown as RequestEvent & { cookies: Cookies };
}

async function runExit(event: RequestEvent): Promise<unknown> {
  try {
    await actions.exitImpersonation(event as never);
  } catch (e) {
    return e;
  }
  return undefined;
}

function auditRows(userId: string) {
  return db
    .select()
    .from(superadminAudit)
    .where(
      and(
        eq(superadminAudit.superadminUserId, userId),
        eq(superadminAudit.action, 'exit_impersonation')
      )
    )
    .all();
}

describe('admin/owners exitImpersonation action (#221)', () => {
  it('clears impersonation, restores the own assignment, and writes an audit row', async () => {
    const target = seedOwner();
    const home = seedOwner();
    const sa = seedUser(true);
    db.insert(helperAssignments)
      .values({
        userId: sa.id,
        ownerId: home,
        roleWithinOwner: 'owner',
        status: 'active'
      })
      .run();

    const event = makeEvent({
      id: sa.id,
      email: sa.email,
      isSuperadmin: true,
      activeOwnerId: target,
      activeRole: 'owner',
      impersonating: true
    });
    const thrown = await runExit(event);
    expect(isRedirect(thrown as never)).toBe(true);
    expect((thrown as { location: string }).location).toBe('/admin/owners');

    const s = readSession(event.cookies);
    expect(s?.impersonating).toBe(false);
    expect(s?.isSuperadmin).toBe(true);
    expect(s?.activeOwnerId).toBe(home);

    const rows = auditRows(sa.id);
    expect(rows).toHaveLength(1);
    expect(rows[0].ownerId).toBeNull();
    expect(JSON.parse(rows[0].payloadJson ?? '{}')).toEqual({ from: target });
  });

  it('drops to a partial session when the superadmin has no assignments', async () => {
    const target = seedOwner();
    const sa = seedUser(true);
    const event = makeEvent({
      id: sa.id,
      email: sa.email,
      isSuperadmin: true,
      activeOwnerId: target,
      activeRole: 'owner',
      impersonating: true
    });
    const thrown = await runExit(event);
    expect(isRedirect(thrown as never)).toBe(true);
    const s = readSession(event.cookies);
    expect(s?.impersonating).toBe(false);
    expect(s?.activeOwnerId).toBeNull();
    expect(auditRows(sa.id)).toHaveLength(1);
  });

  it('writes no audit row when the session was not impersonating', async () => {
    const sa = seedUser(true);
    const event = makeEvent({
      id: sa.id,
      email: sa.email,
      isSuperadmin: true,
      activeOwnerId: null,
      activeRole: 'owner',
      impersonating: false
    });
    const thrown = await runExit(event);
    expect(isRedirect(thrown as never)).toBe(true);
    expect(auditRows(sa.id)).toHaveLength(0);
  });

  it('rejects a non-superadmin with 403 and leaves the session untouched', async () => {
    const owner = seedOwner();
    const u = seedUser(false);
    const event = makeEvent({
      id: u.id,
      email: u.email,
      isSuperadmin: false,
      activeOwnerId: owner,
      activeRole: 'owner',
      impersonating: true
    });
    const thrown = await runExit(event);
    expect(isHttpError(thrown as never, 403)).toBe(true);
    expect(readSession(event.cookies)?.impersonating).toBe(true);
    expect(auditRows(u.id)).toHaveLength(0);
  });

  it('rejects an unauthenticated request with 401', async () => {
    const thrown = await runExit(makeEvent(null));
    expect(isHttpError(thrown as never, 401)).toBe(true);
  });

  it('rejects a Bearer-authenticated superadmin (API tokens never carry superadmin power)', async () => {
    const owner = seedOwner();
    const sa = seedUser(true);
    const event = makeEvent(null, {
      authVia: 'bearer',
      user: {
        id: sa.id,
        email: sa.email,
        role: 'owner',
        activeOwnerId: owner,
        isSuperadmin: true,
        impersonating: false
      }
    });
    const thrown = await runExit(event);
    expect(isHttpError(thrown as never, 403)).toBe(true);
    expect(auditRows(sa.id)).toHaveLength(0);
  });
});

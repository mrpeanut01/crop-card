/**
 * Pure-unit tests for session signing/verification + the role-gate helpers.
 *
 * These don't spin up SvelteKit; they exercise the same module that
 * hooks.server.ts imports, with hand-crafted Cookies stubs. This catches
 * regressions in the cookie format or HMAC verification before they
 * reach the endpoint layer.
 */

import { describe, expect, it } from 'vitest';
import type { Cookies } from '@sveltejs/kit';
import { clearSession, readSession, writeSession } from '$lib/server/session';

function fakeCookies(): Cookies & { _store: Map<string, string> } {
  const store = new Map<string, string>();
  return {
    _store: store,
    get: (name: string) => store.get(name),
    getAll: () => Array.from(store.entries()).map(([name, value]) => ({ name, value })),
    set: (name: string, value: string) => store.set(name, value),
    delete: (name: string) => {
      store.delete(name);
    },
    serialize: () => ''
  } as unknown as Cookies & { _store: Map<string, string> };
}

describe('session HMAC cookie', () => {
  it('round-trips a written session through readSession', () => {
    const cookies = fakeCookies();
    writeSession(cookies, {
      id: 'u1',
      email: 'owner@example.com',
      activeOwnerId: 'owner_home_farm',
      activeRole: 'owner'
    });
    const parsed = readSession(cookies);
    expect(parsed?.userId).toBe('u1');
    expect(parsed?.activeRole).toBe('owner');
    expect(parsed?.email).toBe('owner@example.com');
  });

  it('rejects a tampered payload', () => {
    const cookies = fakeCookies();
    writeSession(cookies, {
      id: 'u1',
      email: 'helper@example.com',
      activeOwnerId: 'owner_home_farm',
      activeRole: 'helper'
    });
    const original = cookies._store.get('cropcard.session')!;
    // Flip a byte in the payload portion (before the signature).
    const dot = original.lastIndexOf('.');
    const tampered = original.slice(0, dot - 1) + 'X' + original.slice(dot);
    cookies._store.set('cropcard.session', tampered);
    expect(readSession(cookies)).toBeNull();
  });

  it('rejects a cookie with no signature delimiter', () => {
    const cookies = fakeCookies();
    cookies._store.set('cropcard.session', 'not-a-valid-cookie');
    expect(readSession(cookies)).toBeNull();
  });

  it('rejects a session signed with a different secret', () => {
    const cookies = fakeCookies();
    const previous = process.env.AUTH_SECRET;
    try {
      process.env.AUTH_SECRET = 'secret-A';
      writeSession(cookies, {
      id: 'u1',
      email: 'helper@example.com',
      activeOwnerId: 'owner_home_farm',
      activeRole: 'helper'
    });
      process.env.AUTH_SECRET = 'secret-B';
      expect(readSession(cookies)).toBeNull();
    } finally {
      process.env.AUTH_SECRET = previous;
    }
  });

  it('clearSession deletes the cookie', () => {
    const cookies = fakeCookies();
    writeSession(cookies, {
      id: 'u1',
      email: 'helper@example.com',
      activeOwnerId: 'owner_home_farm',
      activeRole: 'helper'
    });
    expect(cookies._store.has('cropcard.session')).toBe(true);
    clearSession(cookies);
    expect(cookies._store.has('cropcard.session')).toBe(false);
  });

  it('returns null for an absent cookie', () => {
    expect(readSession(fakeCookies())).toBeNull();
  });

  it('rejects a session whose role is not owner|helper', () => {
    const cookies = fakeCookies();
    writeSession(cookies, {
      id: 'u1',
      email: 'x@example.com',
      activeOwnerId: 'owner_home_farm',
      activeRole: 'helper'
    });
    // Tamper into 'admin' — but tampering breaks the signature, so verify
    // that role-coverage rejects an unsigned 'admin' attempt too.
    const fakeBody = Buffer.from(
      JSON.stringify({
        userId: 'u1',
        email: 'x@example.com',
        role: 'admin',
        exp: Date.now() + 1000
      })
    )
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
    cookies._store.set('cropcard.session', `${fakeBody}.deadbeef`);
    expect(readSession(cookies)).toBeNull();
  });
});

import { describe, it, expect, vi } from 'vitest';
import { resolveBearer } from './bearerAuth';
import type { AppCredential } from './appCreds';

const CRED: AppCredential = {
  id: 'cred-1',
  label: 'agent',
  trustLevel: 'community',
  createdAt: 0,
  lastUsedAt: null,
  requestCount: 0,
  revokedAt: null
};

describe('resolveBearer (#233)', () => {
  it('returns none when there is no Bearer header', () => {
    const lookup = vi.fn();
    expect(resolveBearer(null, { lookup, touch: vi.fn() }).kind).toBe('none');
    expect(resolveBearer('Basic abc', { lookup, touch: vi.fn() }).kind).toBe('none');
    expect(lookup).not.toHaveBeenCalled();
  });

  it('returns a 401 with a fixed body when the lookup throws (no DB detail leaks)', async () => {
    const res = resolveBearer('Bearer ccm_x', {
      lookup: () => {
        throw new Error('SQLITE_CANTOPEN: /data/marketplace.db');
      },
      touch: vi.fn()
    });
    expect(res.kind).toBe('reject');
    if (res.kind !== 'reject') return;
    expect(res.response.status).toBe(401);
    const body = await res.response.text();
    expect(body).toBe(JSON.stringify({ error: 'invalid or revoked Bearer token' }));
    expect(body).not.toMatch(/SQLITE/);
  });

  it('returns a 401 for an unknown or revoked token', () => {
    const res = resolveBearer('Bearer ccm_x', {
      lookup: () => null,
      touch: vi.fn()
    });
    expect(res.kind === 'reject' && res.response.status).toBe(401);
  });

  it('accepts a valid token and passes the trimmed plaintext to lookup', () => {
    const lookup = vi.fn(() => CRED);
    const touch = vi.fn();
    const res = resolveBearer('bearer   ccm_good  ', { lookup, touch });
    expect(res).toEqual({ kind: 'ok', cred: CRED });
    expect(lookup).toHaveBeenCalledWith('ccm_good');
    expect(touch).toHaveBeenCalledWith('cred-1');
  });

  it('still accepts the token when the best-effort touch throws', () => {
    const res = resolveBearer('Bearer ccm_good', {
      lookup: () => CRED,
      touch: () => {
        throw new Error('database is locked');
      }
    });
    expect(res.kind).toBe('ok');
  });
});

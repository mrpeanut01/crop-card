import { describe, expect, it } from 'vitest';
import {
  ANY_ROLE_API_WRITES,
  isAnyRoleApiWrite,
  allowsPartialSession,
  suspendedTenantGate
} from '../../src/hooks.server';

describe('feedback reaches every signed-in person (#466)', () => {
  it('works before onboarding, with no farm yet', () => {
    expect(allowsPartialSession('/api/feedback', false)).toBe(true);
    expect(allowsPartialSession('/api/feedback/extra', false)).toBe(false);
  });

  it('the language choice and your own passkeys are the only API writes open to the read-only inspector role', () => {
    expect([...ANY_ROLE_API_WRITES]).toEqual([
      '/api/feedback',
      '/api/me/locale',
      '/api/auth/passkey/register/options',
      '/api/auth/passkey/register/verify',
      '/api/auth/passkey/offer'
    ]);
    expect(isAnyRoleApiWrite('/api/account/passkeys/pk_1')).toBe(true);
    expect(isAnyRoleApiWrite('/api/account/identity')).toBe(false);
    expect(isAnyRoleApiWrite('/api/account/passkeys-extra')).toBe(false);
  });

  it('still works on a suspended farm', () => {
    expect(suspendedTenantGate('/api/feedback', 'suspended', 'POST')).toBe('allow');
    expect(suspendedTenantGate('/api/blocks', 'suspended', 'POST')).not.toBe('allow');
  });
});

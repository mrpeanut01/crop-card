import { describe, expect, it } from 'vitest';
import {
  ANY_ROLE_API_WRITES,
  allowsPartialSession,
  suspendedTenantGate
} from '../../src/hooks.server';

describe('feedback reaches every signed-in person (#466)', () => {
  it('works before onboarding, with no farm yet', () => {
    expect(allowsPartialSession('/api/feedback', false)).toBe(true);
    expect(allowsPartialSession('/api/feedback/extra', false)).toBe(false);
  });

  it('is the only API write open to the read-only inspector role', () => {
    expect([...ANY_ROLE_API_WRITES]).toEqual(['/api/feedback']);
  });

  it('still works on a suspended farm', () => {
    expect(suspendedTenantGate('/api/feedback', 'suspended', 'POST')).toBe('allow');
    expect(suspendedTenantGate('/api/blocks', 'suspended', 'POST')).not.toBe('allow');
  });
});

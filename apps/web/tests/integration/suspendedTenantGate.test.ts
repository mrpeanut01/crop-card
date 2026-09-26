import { describe, expect, it } from 'vitest';
import { suspendedTenantGate } from '../../src/hooks.server';

describe('suspendedTenantGate', () => {
  it('allows every path when the Owner is not suspended', () => {
    for (const status of [null, 'active', 'trial', 'past_due', 'canceled']) {
      expect(suspendedTenantGate('/api/spray/record', status)).toBe('allow');
      expect(suspendedTenantGate('/today', status)).toBe('allow');
    }
  });

  it('suspended HTML navigation redirects to /suspended', () => {
    expect(suspendedTenantGate('/today', 'suspended')).toBe('redirect');
    expect(suspendedTenantGate('/plan', 'suspended')).toBe('redirect');
  });

  it('suspended /api/** gets a JSON 402, not a redirect to HTML', () => {
    expect(suspendedTenantGate('/api/spray/record', 'suspended')).toBe('json-402');
    expect(suspendedTenantGate('/api/plan/inputs', 'suspended')).toBe('json-402');
  });

  it('billing API stays reachable while suspended', () => {
    expect(suspendedTenantGate('/api/billing/checkout', 'suspended')).toBe('allow');
    expect(suspendedTenantGate('/api/billing/portal', 'suspended')).toBe('allow');
    expect(suspendedTenantGate('/api/billing/stripe-webhook', 'suspended')).toBe('allow');
  });

  it('does not treat look-alike prefixes as billing or API', () => {
    expect(suspendedTenantGate('/api/billingx', 'suspended')).toBe('json-402');
    expect(suspendedTenantGate('/apix/foo', 'suspended')).toBe('redirect');
  });

  it('keeps records, record exports and the data export readable while suspended', () => {
    for (const path of [
      '/records',
      '/records/spray',
      '/api/records/year-summary.pdf',
      '/api/records/export.vdacs.pdf',
      '/api/records/spray/abc/card',
      '/api/spray/records/export.csv',
      '/api/spray/records/export.usda.csv',
      '/api/account/export.json',
      '/settings/billing',
      '/signout'
    ]) {
      expect(suspendedTenantGate(path, 'suspended', 'GET'), path).toBe('allow');
    }
  });

  it('record reads stay open but writes do not', () => {
    expect(suspendedTenantGate('/api/records/spray/abc', 'suspended', 'DELETE')).toBe('json-402');
    expect(suspendedTenantGate('/records', 'suspended', 'POST')).toBe('redirect');
    expect(suspendedTenantGate('/api/spray/record', 'suspended', 'POST')).toBe('json-402');
  });

  it('does not treat look-alike record paths as records', () => {
    expect(suspendedTenantGate('/recordsx', 'suspended', 'GET')).toBe('redirect');
    expect(suspendedTenantGate('/api/account/export.jsonx', 'suspended', 'GET')).toBe('json-402');
  });
});

// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { hasVaultRepo, vaultRepo } from './repo';

describe('vault repo binding', () => {
  it('binds lib/db/documents.ts', () => {
    expect(hasVaultRepo()).toBe(true);
    const r = vaultRepo();
    expect(r.documentStorageKey('owner_a', '00000000-0000-4000-8000-000000000000')).toBe(
      'owners/owner_a/00000000-0000-4000-8000-000000000000'
    );
    expect(typeof r.transaction).toBe('function');
  });
});

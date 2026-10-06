import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Mock the kernel_dry_run_log writer so we don't touch the DB in unit tests.
vi.mock('$lib/db/client', () => ({
  db: { insert: () => ({ values: () => ({ run: () => undefined }) }) }
}));
vi.mock('$lib/db/tenant', () => ({
  currentOwnerId: () => 'owner-test',
  tenantValues: <T extends object>(v: T) => ({ ...v, ownerId: 'owner-test' }),
  unscopedQueryNote: () => undefined
}));

import { runEvaluator } from './dryRunRunner';
import type { SafetyViolation } from './types';

describe('runEvaluator (KERNEL_DRY_RUN wrapper)', () => {
  beforeEach(() => {
    delete process.env.KERNEL_DRY_RUN;
  });
  afterEach(() => {
    delete process.env.KERNEL_DRY_RUN;
  });

  it('returns violations directly when KERNEL_DRY_RUN is unset', () => {
    const v: SafetyViolation[] = [{ code: 'FRAC_ROTATION_BLOCK', message: 'overlap' }];
    const result = runEvaluator('fracRotation', () => v, {
      plannedSpray: { foo: 'bar' },
      blockId: 'b1'
    });
    expect(result).toEqual(v);
  });

  it('swallows violations + returns [] when KERNEL_DRY_RUN=1', () => {
    process.env.KERNEL_DRY_RUN = '1';
    const v: SafetyViolation[] = [{ code: 'IPM_THRESHOLD_NOT_MET', message: 'not met' }];
    const result = runEvaluator('ipmThreshold', () => v, {
      plannedSpray: {},
      blockId: 'b1'
    });
    expect(result).toEqual([]);
  });

  it('also accepts string "true" as truthy for KERNEL_DRY_RUN', () => {
    process.env.KERNEL_DRY_RUN = 'true';
    const result = runEvaluator(
      'pollinatorBloom',
      () => [{ code: 'POLLINATOR_BLOOM_BLOCK', message: 'bloom' }],
      { plannedSpray: {} }
    );
    expect(result).toEqual([]);
  });
});

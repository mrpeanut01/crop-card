import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Mock $env/dynamic/private before importing the module under test —
// dryRunLog reads `env.KERNEL_DRY_RUN` at the top level via its import.
vi.mock('$env/dynamic/private', () => ({
  env: { KERNEL_DRY_RUN: undefined as string | undefined }
}));

// Mock the kernel_dry_run_log writer so we don't touch the DB in unit tests.
vi.mock('$lib/db/client', () => ({
  db: { insert: () => ({ values: () => ({ run: () => undefined }) }) }
}));
vi.mock('$lib/db/tenant', () => ({
  currentOwnerId: () => 'owner-test',
  unscopedQueryNote: () => undefined
}));

import { runEvaluator } from './dryRunRunner';
import { env } from '$env/dynamic/private';
import type { SafetyViolation } from './types';

describe('runEvaluator (KERNEL_DRY_RUN wrapper)', () => {
  beforeEach(() => {
    env.KERNEL_DRY_RUN = undefined;
  });
  afterEach(() => {
    env.KERNEL_DRY_RUN = undefined;
  });

  it('returns violations directly when KERNEL_DRY_RUN is unset', () => {
    const v: SafetyViolation[] = [
      { code: 'FRAC_ROTATION_BLOCK', message: 'overlap' }
    ];
    const result = runEvaluator('fracRotation', () => v, {
      plannedSpray: { foo: 'bar' },
      blockId: 'b1'
    });
    expect(result).toEqual(v);
  });

  it('swallows violations + returns [] when KERNEL_DRY_RUN=1', () => {
    env.KERNEL_DRY_RUN = '1';
    const v: SafetyViolation[] = [
      { code: 'IPM_THRESHOLD_NOT_MET', message: 'not met' }
    ];
    const result = runEvaluator('ipmThreshold', () => v, {
      plannedSpray: {},
      blockId: 'b1'
    });
    expect(result).toEqual([]);
  });

  it('also accepts string "true" as truthy for KERNEL_DRY_RUN', () => {
    env.KERNEL_DRY_RUN = 'true';
    const result = runEvaluator(
      'pollinatorBloom',
      () => [{ code: 'POLLINATOR_BLOOM_BLOCK', message: 'bloom' }],
      { plannedSpray: {} }
    );
    expect(result).toEqual([]);
  });
});

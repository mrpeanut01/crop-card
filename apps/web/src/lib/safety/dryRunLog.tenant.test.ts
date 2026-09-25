import { describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';

vi.mock('$env/dynamic/private', () => ({ env: { KERNEL_DRY_RUN: '1' } }));

import { db } from '$lib/db/client';
import { kernelDryRunLog, owners } from '$lib/db/schema';
import { runWithTenant, withTenant } from '$lib/db/tenant';
import { recordDryRun } from './dryRunLog';

const OWNER_A = 'dry-run-log-owner-a';
const OWNER_B = 'dry-run-log-owner-b';

function ensureOwner(id: string): void {
  db.insert(owners)
    .values({ id, name: id, slug: id, billingStatus: 'active' })
    .onConflictDoNothing()
    .run();
}

function rowsFor(ownerId: string, blockId: string) {
  return runWithTenant(ownerId, () =>
    db
      .select()
      .from(kernelDryRunLog)
      .where(withTenant(kernelDryRunLog, eq(kernelDryRunLog.blockId, blockId)))
      .all()
  );
}

describe('recordDryRun tenant stamping (Invariant 6)', () => {
  it('stamps the active Owner and is invisible to other Owners', () => {
    ensureOwner(OWNER_A);
    ensureOwner(OWNER_B);
    const blockId = `dry-run-block-${Date.now()}`;

    runWithTenant(OWNER_A, () =>
      recordDryRun({ evaluator: 'fracRotation', violations: [], plannedSpray: {}, blockId })
    );

    const mine = rowsFor(OWNER_A, blockId);
    expect(mine).toHaveLength(1);
    expect(mine[0].ownerId).toBe(OWNER_A);
    expect(mine[0].verdict).toBe('ok');
    expect(rowsFor(OWNER_B, blockId)).toHaveLength(0);
  });
});

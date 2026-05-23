/**
 * DELETE /api/plan/reset (Phase 21 follow-up — wizard "Start over").
 *
 * Wipes the active Owner's planning artifacts so the AllocationWizard
 * can restart from a clean slate. Specifically:
 *
 *   - planting_records rows with status='planned' (the wizard's commit
 *     output before a planting actually goes in the ground)
 *   - crops rows with status='planned' (and any cascading events,
 *     though planned crops rarely have any)
 *   - tasks tagged pluginTemplateKey='inputs-plan' AND still open
 *     (completed/aborted tasks survive — executed history stays)
 *
 * Preserves: blocks, fields, stock, equipment, sprayers, and any
 * crops that have advanced past status='planned' (active /
 * harvested / etc.). Owner role gate: only owners can reset their
 * own plan; helpers + inspectors blocked.
 */

import { json, type RequestHandler } from '@sveltejs/kit';

import { wipeCurrentPlan } from '$lib/db/admin';
import { currentUser } from '$lib/server/auth';
import { canMutate } from '$lib/server/session';

export const DELETE: RequestHandler = async (event) => {
  const auth = currentUser(event);
  if (!auth) return json({ error: 'authentication required' }, { status: 401 });
  if (!canMutate(auth.role)) {
    return json({ error: 'inspector role is read-only' }, { status: 403 });
  }
  if (auth.role !== 'owner' && !auth.isSuperadmin) {
    return json({ error: 'only the owner can reset the plan' }, { status: 403 });
  }

  const summary = wipeCurrentPlan();
  return json(summary);
};

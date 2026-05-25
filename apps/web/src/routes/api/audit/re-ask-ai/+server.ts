/**
 * POST /api/audit/re-ask-ai
 *
 * Phase 25d (#89) — owner-only re-run of `ai_call_log` rows tagged
 * `provenance='fallback'`. Given a row id (or "all" for the active
 * owner), retries the AI call now that a key is configured + patches
 * the row with the new `provenance='ai'` + confidence.
 *
 * Per the v2 addendum: "Add a `/api/audit/re-ask-ai` route that, given
 * an audit row where `provenance = 'fallback'`, retries the AI call
 * (once the key is configured) and either patches the row (owner-only)
 * or records a sibling row depending on the audit-chain rules."
 *
 * Phase 25d MVP scope: ship the route shape + auth + GET list. The
 * actual re-run logic per endpoint is a Phase 26 task — each endpoint
 * (allocate, schedule, inputs, ...) needs its own re-issue payload
 * reconstructed from the audit row's context, which is endpoint-specific.
 * This route returns 501 Not Implemented for the actual re-run today.
 */

import { json, type RequestHandler } from '@sveltejs/kit';
import { and, eq } from 'drizzle-orm';
import { db } from '$lib/db/client';
import { aiCallLog } from '$lib/db/schema';
import { withTenant } from '$lib/db/tenant';
import { currentUser } from '$lib/server/auth';
import { getApiKey } from '$lib/server/scanResult';

/** List candidate rows the owner could re-ask. */
export const GET: RequestHandler = (event) => {
  const u = currentUser(event);
  if (!u) return json({ error: 'sign-in required' }, { status: 401 });
  if (u.role !== 'owner') {
    return json({ error: 'owner role required' }, { status: 403 });
  }
  if (!getApiKey()) {
    return json(
      {
        error: 'no API key configured',
        hint: "Save a key on /settings/ai first; the audit re-run can't fire without one."
      },
      { status: 412 }
    );
  }
  const rows = db
    .select({
      id: aiCallLog.id,
      endpoint: aiCallLog.endpoint,
      provenance: aiCallLog.provenance,
      fallbackReason: aiCallLog.fallbackReason,
      attemptedAiAt: aiCallLog.attemptedAiAt,
      createdAt: aiCallLog.createdAt
    })
    .from(aiCallLog)
    .where(withTenant(aiCallLog, eq(aiCallLog.provenance, 'fallback')))
    .orderBy(aiCallLog.createdAt)
    .limit(200)
    .all()
    .reverse();

  return json({
    candidateCount: rows.length,
    rows
  });
};

/** Re-run one row (or `{ all: true }`). Phase 25d MVP returns 501 —
 *  the per-endpoint re-issue logic ships in Phase 26 once each AI
 *  endpoint has been moved onto aiTry() and stores its re-runnable
 *  context in ai_call_log. */
export const POST: RequestHandler = async (event) => {
  const u = currentUser(event);
  if (!u) return json({ error: 'sign-in required' }, { status: 401 });
  if (u.role !== 'owner') {
    return json({ error: 'owner role required' }, { status: 403 });
  }
  if (!getApiKey()) {
    return json(
      { error: 'no API key configured', hint: 'Save a key on /settings/ai first.' },
      { status: 412 }
    );
  }

  let body: { rowId?: string; all?: boolean } = {};
  try {
    body = await event.request.json();
  } catch {
    return json({ error: 'invalid JSON body' }, { status: 400 });
  }

  if (body.rowId) {
    const row = db
      .select({ id: aiCallLog.id, endpoint: aiCallLog.endpoint })
      .from(aiCallLog)
      .where(
        withTenant(
          aiCallLog,
          and(eq(aiCallLog.id, body.rowId), eq(aiCallLog.provenance, 'fallback'))
        )
      )
      .get();
    if (!row) {
      return json(
        { error: 'row not found or not a fallback row', rowId: body.rowId },
        { status: 404 }
      );
    }
    return json(
      {
        error: 'per-endpoint re-run not yet implemented',
        endpoint: row.endpoint,
        rowId: row.id,
        plannedPhase: 26,
        hint: 'Endpoint-specific re-issue logic ships in Phase 26 once each AI endpoint records its full re-runnable context in ai_call_log. The /settings/ai panel still surfaces the fallback breakdown today.'
      },
      { status: 501 }
    );
  }

  return json(
    {
      error: 'bulk re-run not yet implemented',
      plannedPhase: 26,
      hint: 'Future: { all: true } will iterate the candidate list returned by GET. Today, both single-row and bulk re-runs return 501.'
    },
    { status: 501 }
  );
};

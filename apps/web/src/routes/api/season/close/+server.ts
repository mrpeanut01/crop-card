/**
 * POST /api/season/close — UC-44 season close-out (#349). Owner-only.
 *
 * Two actions on one endpoint:
 *   - `close`  — re-verify the server-side preflight (plantings resolved +
 *                harvest roll-up) plus the client-attested pending count,
 *                then write the `season_closeouts` row. The SEASON_CLOSED
 *                gate keys off this row immediately.
 *   - `reopen` — clear the close within the 7-day window. Past the window the
 *                close is permanent (409).
 *
 * The close row is the app-layer equivalent of the FR-09 lock: server-enforced,
 * not UI-only. RULES_VERSION is stamped into the snapshot for provenance; it is
 * NOT bumped (this is not a safety-kernel rule).
 */

import { error, json } from '@sveltejs/kit';
import { z } from 'zod';

import { requireOwner } from '$lib/server/auth';
import { buildCloseoutPreflight } from '$lib/season/closeout.server';
import { closeSeason, reopenSeason } from '$lib/server/seasonClose';

const bodySchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('close'),
    year: z.number().int().min(2000).max(3000),
    /** Client-attested count of offline records still queued for this Owner.
     *  Close is refused unless zero (the offline queue must drain first). */
    pendingCount: z.number().int().nonnegative().default(0),
    /** Operator attestation that the harvest roll-up has been reviewed. */
    harvestAttested: z.boolean()
  }),
  z.object({
    action: z.literal('reopen'),
    year: z.number().int().min(2000).max(3000)
  })
]);

export async function POST(event) {
  const user = requireOwner(event);
  const raw = (await event.request.json().catch(() => null)) as unknown;
  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) {
    error(400, parsed.error.issues[0]?.message ?? 'invalid body');
  }

  if (parsed.data.action === 'reopen') {
    const res = reopenSeason(parsed.data.year);
    if (!res.ok) {
      if (res.code === 'NOT_CLOSED') {
        return json({ error: 'NOT_CLOSED', year: res.year }, { status: 409 });
      }
      return json(
        {
          error: 'REOPEN_WINDOW_EXPIRED',
          year: res.year,
          closedAt: res.closedAt,
          message: 'The 7-day reopen window has passed; this season close is permanent.'
        },
        { status: 409 }
      );
    }
    return json({ ok: true, closeout: res.closeout });
  }

  // action === 'close' — re-verify the preflight server-side.
  const { year, pendingCount, harvestAttested } = parsed.data;
  const preflight = buildCloseoutPreflight(year);

  const failed: string[] = [];
  if (pendingCount > 0) failed.push('PENDING_NOT_DRAINED');
  if (!preflight.plantingsResolved) failed.push('PLANTINGS_UNRESOLVED');
  if (!harvestAttested) failed.push('HARVEST_NOT_ATTESTED');
  if (failed.length > 0) {
    return json(
      {
        error: 'PREFLIGHT_FAILED',
        failed,
        unresolvedCount: preflight.unresolvedCount,
        pendingCount
      },
      { status: 422 }
    );
  }

  const res = closeSeason({
    year,
    closedById: user.id,
    plantingResolutions: preflight.plantings.map((p) => ({ cropId: p.cropId, status: p.status })),
    harvestRollup: {
      eventCount: preflight.harvest.eventCount,
      byCropPlugin: preflight.harvest.byCropPlugin
    },
    pendingCount
  });

  if (!res.ok) {
    return json({ error: 'ALREADY_CLOSED', year: res.year }, { status: 409 });
  }
  return json({ ok: true, closeout: res.closeout });
}

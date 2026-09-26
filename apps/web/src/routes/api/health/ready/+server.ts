import { json } from '@sveltejs/kit';
import { pingDb } from '$lib/db/client';
import { handoffStatus } from '$lib/server/ops/handoff';

/** Readiness: the database answers. A container that is handing off to a
 *  newer one stays ready, because it still serves reads; its writes are
 *  refused by the fence in hooks.server.ts. Liveness stays on /api/health. */
export const GET = () => {
  const handoff = handoffStatus().phase;
  try {
    pingDb();
  } catch (e) {
    return json(
      { status: 'unavailable', db: e instanceof Error ? e.message : String(e), handoff },
      { status: 503, headers: { 'cache-control': 'no-store' } }
    );
  }
  return json(
    { status: 'ok', db: 'ok', handoff, version: process.env.BUILD_SHA || 'dev' },
    { headers: { 'cache-control': 'no-store' } }
  );
};

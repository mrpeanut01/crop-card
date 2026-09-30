import { json, type RequestHandler } from '@sveltejs/kit';
import { MAX_FUTURE_SKEW_MS } from '$lib/animals/model';
import { getSeedStart, recordSeedStartProgress } from '$lib/db/seedStarts';
import { germinationMax } from '$lib/schedule/seedStart';
import { seedStartProgressSchema } from '$lib/seedStart/apiSchemas';
import { parseBody } from '$lib/server/animals';
import { requireMutator } from '$lib/server/auth';
import { withClientRecordId } from '$lib/server/clientRecordId';
import { writeRecord } from '$lib/server/recordWrite';

export const _requestSchema = seedStartProgressSchema;

/**
 * POST /api/seed-starts/[id]/progress. Owners and helpers record the
 * germinated count (absolute; the latest `observedAt` wins), when hardening
 * off started and when the tray went out (E1-14, E1-15). The `seed-start`
 * offline queue kind replays here. Never gated by SEASON_CLOSED.
 */
export const POST: RequestHandler = withClientRecordId(async (event) => {
  requireMutator(event);
  const id = event.params.id ?? '';
  const tray = getSeedStart(id);
  if (!tray) return json({ error: 'not found' }, { status: 404 });
  const body = await parseBody(event.request, seedStartProgressSchema);
  if (!body.ok) return body.response;
  const input = body.data;
  const now = Date.now();
  const observedAt = input.observedAt ?? now;
  for (const at of [observedAt, input.hardenStartedAt, input.transplantedAt]) {
    if (at !== undefined && at > now + MAX_FUTURE_SKEW_MS) {
      return json(
        { error: 'Tray progress cannot be dated in the future.', code: 'IN_THE_FUTURE' },
        { status: 400 }
      );
    }
  }
  const max = germinationMax(tray.cells, tray.seedsPerCell);
  if (input.germinatedCount !== undefined && input.germinatedCount > max) {
    return json(
      {
        error: `That is more than the ${max} seeds in this tray.`,
        code: 'OVER_TRAY'
      },
      { status: 400 }
    );
  }
  const result = writeRecord(event, () => recordSeedStartProgress(id, { ...input, observedAt }));
  if (!result) return json({ error: 'not found' }, { status: 404 });
  return json(result, { status: 201 });
});

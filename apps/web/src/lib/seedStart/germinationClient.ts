/** Sends a germination count, or keeps it on the phone when there is no
 *  signal (Phase 32E, E1-18). The count is absolute and carries the moment
 *  it was seen, so a late replay never overwrites a newer count. The online
 *  attempt and a queued replay share one client record id. */

import { CLIENT_RECORD_HEADER } from '$lib/clientRecordHeader';
import { isUpdatingResponse } from '$lib/updating';

export type GerminationOutcome =
  { status: 'saved'; count: number } | { status: 'queued' } | { status: 'error'; message: string };

type FetchFn = typeof fetch;

function recordId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `pending_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

async function queue(
  seedStartId: string,
  body: { germinatedCount: number; observedAt: number },
  id: string
): Promise<GerminationOutcome> {
  const { enqueueRecord } = await import('$lib/client/syncQueue');
  await enqueueRecord('seed-start', { seedStartId, ...body }, id);
  return { status: 'queued' };
}

export async function submitGermination(
  seedStartId: string,
  germinatedCount: number,
  fetchFn: FetchFn = fetch,
  online: () => boolean = () => typeof navigator === 'undefined' || navigator.onLine !== false,
  now: number = Date.now()
): Promise<GerminationOutcome> {
  const body = { germinatedCount, observedAt: now };
  const id = recordId();
  if (!online()) return queue(seedStartId, body, id);
  let res: Response;
  try {
    res = await fetchFn(`/api/seed-starts/${encodeURIComponent(seedStartId)}/progress`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', [CLIENT_RECORD_HEADER]: id },
      body: JSON.stringify(body)
    });
  } catch {
    return queue(seedStartId, body, id);
  }
  if (isUpdatingResponse(res) || res.status >= 500) return queue(seedStartId, body, id);
  if (!res.ok) {
    const err = (await res.json().catch(() => null)) as { error?: string } | null;
    return { status: 'error', message: err?.error ?? `Could not save (${res.status}).` };
  }
  return { status: 'saved', count: germinatedCount };
}

/** Sends a move, or keeps it on the phone when there is no signal. The
 *  queued move carries the time it happened, so the replay lands at that
 *  moment even if it drains hours later. The online attempt and any queued
 *  replay share one client record id, so a move whose response was lost is
 *  not saved twice. */

import type { AnimalMoveInput } from './apiSchemas';
import { errorFromResponse } from './display';
import { isUpdatingResponse, retryAfterSeconds } from '$lib/updating';
import { CLIENT_RECORD_HEADER } from '$lib/clientRecordHeader';

export type MoveOutcome =
  | { status: 'saved'; move: MoveResponse }
  | { status: 'queued' }
  | { status: 'error'; message: string };

export interface MoveResponse {
  fieldId: string | null;
  newGroup: { id: string; name: string } | null;
  capacity: { capacity: number; count: number; over: boolean } | null;
}

type FetchFn = typeof fetch;

function recordId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `pending_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

async function queue(payload: AnimalMoveInput, id: string): Promise<MoveOutcome> {
  const { enqueueRecord } = await import('$lib/client/syncQueue');
  await enqueueRecord('animal-move', payload, id);
  return { status: 'queued' };
}

function looksOffline(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e);
  return e instanceof TypeError && /(fetch|network|failed|load)/i.test(msg);
}

export async function submitMove(
  input: AnimalMoveInput,
  fetchFn: FetchFn = fetch,
  online: () => boolean = () => typeof navigator === 'undefined' || navigator.onLine !== false
): Promise<MoveOutcome> {
  const payload: AnimalMoveInput = { ...input, movedAt: input.movedAt ?? Date.now() };
  const id = recordId();
  if (!online()) return queue(payload, id);
  let res: Response;
  try {
    res = await fetchFn('/api/animals/move', {
      method: 'POST',
      headers: { 'content-type': 'application/json', [CLIENT_RECORD_HEADER]: id },
      body: JSON.stringify(payload)
    });
  } catch (e) {
    if (looksOffline(e)) return queue(payload, id);
    throw e;
  }
  if (isUpdatingResponse(res)) {
    const out = await queue(payload, id);
    const { scheduleDrain } = await import('$lib/client/syncQueue');
    scheduleDrain((retryAfterSeconds(res) + 2) * 1000);
    return out;
  }
  if (!res.ok) return { status: 'error', message: await errorFromResponse(res) };
  const body = (await res.json()) as { move: MoveResponse };
  return { status: 'saved', move: body.move };
}

/** Sends a move, or keeps it on the phone when there is no signal. The
 *  queued move carries the time it happened, so the replay lands at that
 *  moment even if it drains hours later. The online attempt and any queued
 *  replay share one client record id, so a move whose response was lost is
 *  not saved twice. */

import type { AnimalMoveInput } from './apiSchemas';
import { errorFromResponse } from './display';
import { isUpdatingResponse, retryAfterSeconds } from '$lib/updating';
import { CLIENT_RECORD_HEADER } from '$lib/clientRecordHeader';
import { grazingTimeHref } from './holdCopy';
import { noteHoldWrite } from './recordClient';

export type MoveOutcome =
  | { status: 'saved'; move: MoveResponse; warnings?: string[] }
  | { status: 'queued' }
  | {
      status: 'error';
      message: string;
      attestHref?: string;
      /** C-35: the same move dated now would save. */
      saveToday?: boolean;
    };

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

/** A queued move replays as a live move at its tapped-at time (D1-06), so
 *  a grazing hold found on replay parks it for "Keep animals here" instead
 *  of saving it as a move that already happened. */
async function queue(payload: AnimalMoveInput, id: string): Promise<MoveOutcome> {
  const { enqueueRecord } = await import('$lib/client/syncQueue');
  await enqueueRecord('animal-move', { ...payload, queuedLive: true }, id);
  return { status: 'queued' };
}

function looksOffline(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e);
  return e instanceof TypeError && /(fetch|network|failed|load)/i.test(msg);
}

export async function submitMove(
  input: AnimalMoveInput,
  fetchFn: FetchFn = fetch,
  online: () => boolean = () => typeof navigator === 'undefined' || navigator.onLine !== false,
  locale?: string | null
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
  if (!res.ok) {
    const stop = (await res
      .clone()
      .json()
      .catch(() => null)) as {
      ownerCanAttest?: boolean;
      askOwner?: boolean;
      fieldId?: string | null;
      code?: string;
      todayVersionPasses?: boolean;
    } | null;
    const message = await errorFromResponse(res, locale);
    if (stop?.code === 'HOLD_WOULD_SHORTEN' && stop.todayVersionPasses) {
      return { status: 'error', message, saveToday: true };
    }
    return stop?.ownerCanAttest && !stop.askOwner && stop.fieldId
      ? { status: 'error', message, attestHref: grazingTimeHref(stop.fieldId) }
      : { status: 'error', message };
  }
  const body = (await res.json()) as { move: MoveResponse; warnings?: string[] };
  await noteHoldWrite('animal-move', payload);
  return body.warnings?.length
    ? { status: 'saved', move: body.move, warnings: body.warnings }
    : { status: 'saved', move: body.move };
}

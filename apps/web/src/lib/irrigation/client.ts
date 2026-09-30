/** Sends a watering log or gauge reading, or keeps it on the phone when
 *  there is no signal (Phase 32E, E0-8). The online try and any queued
 *  replay share one client record id, so a lost response never saves twice. */

import { CLIENT_RECORD_HEADER } from '$lib/clientRecordHeader';
import { isUpdatingResponse, retryAfterSeconds } from '$lib/updating';
import type { IrrigationCreate, RainGaugeCreate } from './apiSchemas';

export type SaveOutcome<T> =
  { status: 'saved'; body: T } | { status: 'queued' } | { status: 'error'; message: string };

type FetchFn = typeof fetch;

function recordId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `pending_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function looksOffline(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e);
  return e instanceof TypeError && /(fetch|network|failed|load)/i.test(msg);
}

async function queue(kind: 'irrigation' | 'rain-gauge', payload: unknown, id: string) {
  const { enqueueRecord } = await import('$lib/client/syncQueue');
  await enqueueRecord(kind, payload, id);
  return { status: 'queued' as const };
}

async function send<T>(
  kind: 'irrigation' | 'rain-gauge',
  url: string,
  payload: unknown,
  fetchFn: FetchFn,
  online: () => boolean
): Promise<SaveOutcome<T>> {
  const id = recordId();
  if (!online()) return queue(kind, payload, id);
  let res: Response;
  try {
    res = await fetchFn(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', [CLIENT_RECORD_HEADER]: id },
      body: JSON.stringify(payload)
    });
  } catch (e) {
    if (looksOffline(e)) return queue(kind, payload, id);
    throw e;
  }
  if (isUpdatingResponse(res)) {
    const out = await queue(kind, payload, id);
    const { scheduleDrain } = await import('$lib/client/syncQueue');
    scheduleDrain((retryAfterSeconds(res) + 2) * 1000);
    return out;
  }
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    return { status: 'error', message: body?.error ?? 'That did not save. Try again.' };
  }
  return { status: 'saved', body: (await res.json()) as T };
}

const isOnline = () => typeof navigator === 'undefined' || navigator.onLine !== false;

export function submitWatering(
  input: IrrigationCreate,
  fetchFn: FetchFn = fetch,
  online: () => boolean = isOnline
): Promise<SaveOutcome<{ irrigation: { id: string } }>> {
  const payload = { ...input, occurredAt: input.occurredAt ?? Date.now() };
  return send('irrigation', '/api/irrigation', payload, fetchFn, online);
}

export function submitGauge(
  input: RainGaugeCreate,
  fetchFn: FetchFn = fetch,
  online: () => boolean = isOnline
): Promise<SaveOutcome<{ readings: Array<{ id: string; countsFrom: number }> }>> {
  const payload = { ...input, readAt: input.readAt ?? Date.now() };
  return send('rain-gauge', '/api/rain-gauge', payload, fetchFn, online);
}

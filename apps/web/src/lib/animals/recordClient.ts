/** Sends an egg, milk or treatment log, or feed use, or keeps it on the
 *  phone when there is no signal (32D Flock Card quick actions). The online
 *  attempt and any queued replay share one client record id, so a log
 *  whose response was lost is saved once. A hold stop is returned to the
 *  caller, never queued: the only way on is "Save as discard". */

import type { HealthRecordInput, ProductionRecordInput } from './recordApiSchemas';
import type { FeedUseInput } from '$lib/stock/apiSchemas';
import { errorFromResponse } from './display';
import { discardStopOf, type FoodStop } from './holdCopy';
import { isUpdatingResponse, retryAfterSeconds } from '$lib/updating';
import { CLIENT_RECORD_HEADER } from '$lib/clientRecordHeader';

export type RecordOutcome =
  | { status: 'saved'; warnings: string[] }
  | { status: 'queued' }
  | { status: 'stopped'; stop: FoodStop }
  | { status: 'error'; message: string };

type Kind = 'animal-production' | 'animal-health' | 'feed-use';
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

async function queue(kind: Kind, payload: unknown, id: string): Promise<RecordOutcome> {
  const { enqueueRecord } = await import('$lib/client/syncQueue');
  await enqueueRecord(kind, payload, id);
  return { status: 'queued' };
}

async function submit(
  kind: Kind,
  url: string,
  body: unknown,
  queued: unknown,
  fetchFn: FetchFn,
  online: () => boolean,
  locale?: string | null
): Promise<RecordOutcome> {
  const id = recordId();
  if (!online()) return queue(kind, queued, id);
  let res: Response;
  try {
    res = await fetchFn(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', [CLIENT_RECORD_HEADER]: id },
      body: JSON.stringify(body)
    });
  } catch (e) {
    if (looksOffline(e)) return queue(kind, queued, id);
    throw e;
  }
  if (isUpdatingResponse(res)) {
    const out = await queue(kind, queued, id);
    const { scheduleDrain } = await import('$lib/client/syncQueue');
    scheduleDrain((retryAfterSeconds(res) + 2) * 1000);
    return out;
  }
  if (res.status === 422 || res.status === 409) {
    const out = (await res
      .clone()
      .json()
      .catch(() => null)) as unknown;
    const stop = discardStopOf(res.status, out);
    if (stop) return { status: 'stopped', stop };
  }
  if (!res.ok) return { status: 'error', message: await errorFromResponse(res, locale) };
  const out = (await res.json().catch(() => ({}))) as { warnings?: { message: string }[] };
  if (kind === 'animal-health') await noteHoldWrite('animal-health', body);
  return { status: 'saved', warnings: (out.warnings ?? []).map((w) => w.message) };
}

/** An online save the stored snapshot does not show yet (D1-04). */
export async function noteHoldWrite(
  kind: import('$lib/client/onlineHoldWrites').HoldWriteKind,
  payload: unknown
): Promise<void> {
  try {
    const { noteOnlineHoldWrite } = await import('$lib/client/onlineHoldWrites');
    noteOnlineHoldWrite(kind, payload);
  } catch {
    /* no storage: the card falls back to the snapshot's age */
  }
}

const isOnline = () => typeof navigator === 'undefined' || navigator.onLine !== false;

export function submitProduction(
  input: ProductionRecordInput,
  fetchFn: FetchFn = fetch,
  online: () => boolean = isOnline,
  locale?: string | null
): Promise<RecordOutcome> {
  const payload = { ...input, occurredAt: input.occurredAt ?? Date.now() };
  return submit(
    'animal-production',
    '/api/animals/production/record',
    payload,
    payload,
    fetchFn,
    online,
    locale
  );
}

export function submitHealth(
  input: HealthRecordInput,
  fetchFn: FetchFn = fetch,
  online: () => boolean = isOnline,
  locale?: string | null
): Promise<RecordOutcome> {
  return submit(
    'animal-health',
    '/api/animals/health/record',
    input,
    input,
    fetchFn,
    online,
    locale
  );
}

export function submitFeedUse(
  stockItemId: string,
  input: FeedUseInput,
  fetchFn: FetchFn = fetch,
  online: () => boolean = isOnline,
  locale?: string | null
): Promise<RecordOutcome> {
  const body = { ...input, occurredAt: input.occurredAt ?? Date.now() };
  return submit(
    'feed-use',
    `/api/stock/${encodeURIComponent(stockItemId)}/use`,
    body,
    { ...body, stockItemId },
    fetchFn,
    online,
    locale
  );
}

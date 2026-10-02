/** Sends a new disposition, or keeps it on the phone when there is no
 *  signal (B-34). The online try and any queued replay share one client
 *  record id, so a lost response never saves twice. Edits and deletes are
 *  online only. */

import { CLIENT_RECORD_HEADER } from '$lib/clientRecordHeader';
import { isUpdatingResponse, retryAfterSeconds } from '$lib/updating';
import type { DispositionCreate, DispositionQueuePayload } from './apiSchemas';
import type { DispositionView } from './dispositions';
import { t } from '$lib/i18n';

export interface DispositionSaved {
  disposition: DispositionView;
  organicNotice: string | null;
  quantityNotice: string | null;
}

export type DispositionOutcome =
  | { status: 'saved'; body: DispositionSaved }
  | { status: 'queued' }
  | { status: 'error'; message: string };

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

async function queue(payload: DispositionQueuePayload, id: string): Promise<DispositionOutcome> {
  const { enqueueRecord } = await import('$lib/client/syncQueue');
  await enqueueRecord('harvest-disposition', payload, id);
  return { status: 'queued' };
}

const isOnline = () => typeof navigator === 'undefined' || navigator.onLine !== false;

export async function submitDisposition(
  harvestEventId: string,
  input: DispositionCreate,
  fetchFn: FetchFn = fetch,
  online: () => boolean = isOnline,
  locale?: string | null
): Promise<DispositionOutcome> {
  const id = recordId();
  const body: DispositionCreate = { ...input, occurredAt: input.occurredAt ?? Date.now() };
  const payload: DispositionQueuePayload = { ...body, harvestEventId };
  if (!online()) return queue(payload, id);
  let res: Response;
  try {
    res = await fetchFn(`/api/harvest/${encodeURIComponent(harvestEventId)}/dispositions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', [CLIENT_RECORD_HEADER]: id },
      body: JSON.stringify(body)
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
    const out = (await res.json().catch(() => null)) as { message?: string; error?: string } | null;
    return {
      status: 'error',
      message: out?.message ?? out?.error ?? t(locale, 'harvestui.disp.err.notSaved')
    };
  }
  return { status: 'saved', body: (await res.json()) as DispositionSaved };
}

/** Edits to a planting or task that try the server first and stay on the
 *  phone when there is no signal (Phase 36, U-01, C-U1). The online try and
 *  any queued replay share one client record id, so a lost response never
 *  saves the edit twice. Client-safe; Dexie is loaded lazily. */

import { CLIENT_RECORD_HEADER } from '$lib/clientRecordHeader';
import { isUpdatingResponse, retryAfterSeconds } from '$lib/updating';
import { isEditConflictBody, type EditConflictBody, type EditTarget } from './conflict';
import type { EditBody } from './resolve';

export interface RecordEditPayload {
  target: EditTarget;
  id: string;
  body: EditBody;
  /** Shown on /records/pending, never sent. */
  label: string;
}

export const RECORD_EDIT_KIND = 'record-edit' as const;

const ID_PATTERN = /^[A-Za-z0-9_.:-]{1,200}$/;

/** The PATCH path for a target, or null for an id that is not safe in a path. */
export function recordEditPath(target: EditTarget, id: string): string | null {
  if (!ID_PATTERN.test(id)) return null;
  return target === 'planting'
    ? `/api/crops/${encodeURIComponent(id)}`
    : `/api/tasks/${encodeURIComponent(id)}`;
}

export function isRecordEditPayload(x: unknown): x is RecordEditPayload {
  if (!x || typeof x !== 'object') return false;
  const p = x as Record<string, unknown>;
  if (p.target !== 'planting' && p.target !== 'task') return false;
  if (typeof p.id !== 'string' || typeof p.label !== 'string') return false;
  const b = p.body as Record<string, unknown> | null;
  return (
    !!b &&
    typeof b === 'object' &&
    typeof b.action === 'string' &&
    !!b.base &&
    typeof b.base === 'object'
  );
}

function recordId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `pending_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function isOnline(): boolean {
  return typeof navigator === 'undefined' || navigator.onLine !== false;
}

/** Queues the edit under `id` (a fresh one when omitted). */
export async function enqueueRecordEdit(
  payload: RecordEditPayload,
  id: string = recordId()
): Promise<string> {
  const { enqueueRecord } = await import('$lib/client/syncQueue');
  return enqueueRecord(RECORD_EDIT_KIND, payload, id);
}

export type RecordEditOutcome =
  | { status: 'saved'; response: unknown }
  | { status: 'queued'; rowId: string }
  | { status: 'conflict'; conflict: EditConflictBody }
  | { status: 'refused'; error: string; httpStatus: number };

interface SendOpts {
  fetchFn?: typeof fetch;
  online?: boolean;
}

/** One edit: online first, queued on a network error, a 5xx or the deploy
 *  fence's 503. A 409 EDIT_CONFLICT comes back for the farmer to resolve. */
export async function sendRecordEdit(
  payload: RecordEditPayload,
  opts: SendOpts = {}
): Promise<RecordEditOutcome> {
  const id = recordId();
  const path = recordEditPath(payload.target, payload.id);
  if (!path) return { status: 'refused', error: 'bad id', httpStatus: 400 };
  if (!(opts.online ?? isOnline())) {
    return { status: 'queued', rowId: await enqueueRecordEdit(payload, id) };
  }
  const fetchFn = opts.fetchFn ?? fetch;
  let res: Response;
  try {
    res = await fetchFn(path, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', [CLIENT_RECORD_HEADER]: id },
      body: JSON.stringify(payload.body)
    });
  } catch {
    return { status: 'queued', rowId: await enqueueRecordEdit(payload, id) };
  }
  if (res.status >= 500) {
    const rowId = await enqueueRecordEdit(payload, id);
    const { scheduleDrain } = await import('$lib/client/syncQueue');
    scheduleDrain(isUpdatingResponse(res) ? (retryAfterSeconds(res) + 2) * 1000 : 15_000);
    return { status: 'queued', rowId };
  }
  const out = (await res.json().catch(() => null)) as unknown;
  if (res.ok) return { status: 'saved', response: out };
  if (res.status === 409 && isEditConflictBody(out)) return { status: 'conflict', conflict: out };
  const error = (out as { error?: unknown } | null)?.error;
  return {
    status: 'refused',
    error: typeof error === 'string' ? error : `HTTP ${res.status}`,
    httpStatus: res.status
  };
}

export type RecordEditRun =
  | { status: 'done'; saved: number; queued: number }
  | {
      status: 'conflict';
      conflict: EditConflictBody;
      /** The edit that was refused, then the ones not sent yet. */
      remaining: RecordEditPayload[];
      saved: number;
    }
  | { status: 'refused'; error: string; httpStatus: number; saved: number };

/** Sends edits in order. Once one is queued, the rest are queued too, so
 *  they upload together. Stops at the first conflict or refusal. */
export async function runRecordEdits(
  payloads: readonly RecordEditPayload[],
  opts: SendOpts = {}
): Promise<RecordEditRun> {
  let saved = 0;
  let queued = 0;
  for (let i = 0; i < payloads.length; i++) {
    const p = payloads[i];
    if (queued > 0) {
      await enqueueRecordEdit(p);
      queued++;
      continue;
    }
    const out = await sendRecordEdit(p, opts);
    if (out.status === 'saved') saved++;
    else if (out.status === 'queued') queued++;
    else if (out.status === 'conflict') {
      return { status: 'conflict', conflict: out.conflict, remaining: payloads.slice(i), saved };
    } else {
      return { status: 'refused', error: out.error, httpStatus: out.httpStatus, saved };
    }
  }
  return { status: 'done', saved, queued };
}

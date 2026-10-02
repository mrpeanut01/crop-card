/** Saves time from the task timer, or keeps it on the phone when there is
 *  no signal (D-29). The online try and any queued replay share one client
 *  record id, so a lost response never saves twice. Listing and removing
 *  saved time are online only (D-26, D-27). */

import { CLIENT_RECORD_HEADER } from '$lib/clientRecordHeader';
import { isUpdatingResponse, retryAfterSeconds } from '$lib/updating';
import { enqueueRecord, scheduleDrain } from './syncQueue';
import type { TaskTimeEntryInput, TaskTimeEntryQueuePayload } from '$lib/tasks/apiSchemas';
import type { TaskTimeEntryView, TaskTimeSummary } from '$lib/tasks/timeEntries';

export type TaskTimeOutcome =
  | { status: 'saved'; entry: TaskTimeEntryView | null }
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

async function queue(payload: TaskTimeEntryQueuePayload, id: string): Promise<TaskTimeOutcome> {
  await enqueueRecord('time-entry', payload, id);
  return { status: 'queued' };
}

const isOnline = () => typeof navigator === 'undefined' || navigator.onLine !== false;

async function errorMessage(res: Response): Promise<string> {
  const out = (await res.json().catch(() => null)) as { message?: string; error?: string } | null;
  return out?.message ?? out?.error ?? 'That did not save. Try again.';
}

export async function saveTaskTime(
  taskId: string,
  input: TaskTimeEntryInput,
  fetchFn: FetchFn = fetch,
  online: () => boolean = isOnline
): Promise<TaskTimeOutcome> {
  const id = recordId();
  const payload: TaskTimeEntryQueuePayload = { ...input, taskId };
  if (!online()) return queue(payload, id);
  let res: Response;
  try {
    res = await fetchFn(`/api/tasks/${encodeURIComponent(taskId)}/time`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', [CLIENT_RECORD_HEADER]: id },
      body: JSON.stringify(input)
    });
  } catch (e) {
    if (looksOffline(e)) return queue(payload, id);
    throw e;
  }
  if (isUpdatingResponse(res)) {
    const out = await queue(payload, id);
    scheduleDrain((retryAfterSeconds(res) + 2) * 1000);
    return out;
  }
  if (!res.ok) return { status: 'error', message: await errorMessage(res) };
  const body = (await res.json().catch(() => null)) as { entry?: TaskTimeEntryView } | null;
  return { status: 'saved', entry: body?.entry ?? null };
}

export async function loadTaskTime(
  taskId: string,
  fetchFn: FetchFn = fetch
): Promise<{ ok: true; summary: TaskTimeSummary } | { ok: false; offline: boolean }> {
  try {
    const res = await fetchFn(`/api/tasks/${encodeURIComponent(taskId)}/time`);
    if (!res.ok) return { ok: false, offline: false };
    return { ok: true, summary: (await res.json()) as TaskTimeSummary };
  } catch (e) {
    return { ok: false, offline: looksOffline(e) || !isOnline() };
  }
}

export async function removeTaskTime(
  entryId: string,
  fetchFn: FetchFn = fetch
): Promise<{ ok: true } | { ok: false; message: string }> {
  try {
    const res = await fetchFn(`/api/tasks/time/${encodeURIComponent(entryId)}`, {
      method: 'DELETE'
    });
    if (res.ok) return { ok: true };
    return { ok: false, message: await errorMessage(res) };
  } catch {
    return { ok: false, message: 'No connection. Try again with signal.' };
  }
}

/** Done and Skip for the /today care cards (32D). Each task keeps one
 *  client record id across retries, so a retry after a partial failure
 *  replays the items that already saved instead of saving them again, and
 *  the items that saved are dropped from the next attempt. The server's
 *  warnings (label use downgraded, covered logs, stock not deducted, job
 *  already closed) are kept for the caller to show. */

import { errorFromResponse } from './display';
import { isUpdatingResponse, retryAfterSeconds } from '$lib/updating';
import { CLIENT_RECORD_HEADER } from '$lib/clientRecordHeader';
import type { CareCloseExtra } from '$lib/client/taskQueue';
import { noteHoldWrite } from './recordClient';

export type CareCloseAction = 'complete' | 'abort';

export interface CareCloseDeps {
  fetchFn?: typeof fetch;
  online?: () => boolean;
  queue?: (
    taskId: string,
    action: CareCloseAction,
    extra: CareCloseExtra,
    clientId: string,
    retryAfterMs?: number
  ) => Promise<void>;
  newId?: () => string;
  /** The viewer's language for refusal messages. */
  locale?: string | null;
}

export interface CareCloseRun {
  saved: number;
  queued: number;
  warnings: string[];
  error: string | null;
}

async function defaultQueue(
  taskId: string,
  action: CareCloseAction,
  extra: CareCloseExtra,
  clientId: string,
  retryAfterMs?: number
): Promise<void> {
  const { queueTaskAction } = await import('$lib/client/taskQueue');
  await queueTaskAction(taskId, action, undefined, extra, clientId);
  if (retryAfterMs !== undefined) {
    const { scheduleDrain } = await import('$lib/client/syncQueue');
    scheduleDrain(retryAfterMs);
  }
}

const defaultOnline = () => typeof navigator === 'undefined' || navigator.onLine !== false;
const defaultId = () => crypto.randomUUID();

/** One care card's close attempts. Keep it for as long as the form is open. */
export class CareCloser {
  private ids = new Map<string, string>();
  private done = new Set<string>();

  constructor(private deps: CareCloseDeps = {}) {}

  /** Tasks this form already saved or queued, which a retry must skip. */
  has(taskId: string): boolean {
    return this.done.has(taskId);
  }

  private idFor(taskId: string, action: CareCloseAction): string {
    const key = `${action}:${taskId}`;
    let id = this.ids.get(key);
    if (!id) {
      id = (this.deps.newId ?? defaultId)();
      this.ids.set(key, id);
    }
    return id;
  }

  async run<T extends { taskId: string }>(
    items: readonly T[],
    action: CareCloseAction,
    extraFor: (item: T) => CareCloseExtra
  ): Promise<CareCloseRun> {
    const fetchFn = this.deps.fetchFn ?? fetch;
    const online = this.deps.online ?? defaultOnline;
    const queue = this.deps.queue ?? defaultQueue;
    const out: CareCloseRun = { saved: 0, queued: 0, warnings: [], error: null };
    for (const item of items) {
      if (this.done.has(item.taskId)) continue;
      const extra = extraFor(item);
      const clientId = this.idFor(item.taskId, action);
      const enqueue = async (retryAfterMs?: number) => {
        await queue(item.taskId, action, extra, clientId, retryAfterMs);
        this.done.add(item.taskId);
        out.queued++;
      };
      if (!online()) {
        await enqueue();
        continue;
      }
      let res: Response;
      try {
        res = await fetchFn('/api/tasks/close', {
          method: 'POST',
          headers: { 'content-type': 'application/json', [CLIENT_RECORD_HEADER]: clientId },
          body: JSON.stringify({ taskId: item.taskId, action, occurredAt: Date.now(), ...extra })
        });
      } catch {
        await enqueue();
        continue;
      }
      if (isUpdatingResponse(res)) {
        await enqueue((retryAfterSeconds(res) + 2) * 1000);
        continue;
      }
      if (!res.ok) {
        out.error = await errorFromResponse(res, this.deps.locale);
        return out;
      }
      const body = (await res.json().catch(() => ({}))) as {
        warnings?: { message?: string }[];
      };
      for (const w of body.warnings ?? []) {
        if (w.message && !out.warnings.includes(w.message)) out.warnings.push(w.message);
      }
      if (extra.healthEvent) await noteHoldWrite('animal-health', extra.healthEvent);
      this.done.add(item.taskId);
      out.saved++;
    }
    return out;
  }
}

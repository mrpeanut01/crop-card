/**
 * Phase 32F F4. Reads for the Monday summary, run by the push tick inside
 * one Owner's tenant context. Every tenant table goes through `withTenant`;
 * `users` is global and read only by id for the names of this farm's members.
 */

import { and, gte, inArray, isNotNull, isNull, lt, lte, or } from 'drizzle-orm';
import { db } from './client';
import { blocks, ledgerEntries, taskTimeEntries, tasks, users } from './schema';
import { withTenant } from './tenant';
import { memberName } from '$lib/tasks/assignee';
import { isSprayTask, type DigestTask, type DigestTimeEntry } from '$lib/digest/weekly';

export interface DigestTaskRow extends DigestTask {
  kind: 'primary' | 'pre-task' | 'post-task';
  category: string | null;
}

/**
 * Tasks that are open and scheduled in `[openFromMs, openToMs]`, plus tasks
 * closed at or after `closedFromMs`. Superseded rows are left out.
 */
export function listDigestTasks(range: {
  openFromMs: number;
  openToMs: number;
  closedFromMs: number;
  closedToMs: number;
}): DigestTaskRow[] {
  const open = and(
    isNull(tasks.completedAt),
    isNull(tasks.abortedAt),
    gte(tasks.scheduledFor, new Date(range.openFromMs)),
    lte(tasks.scheduledFor, new Date(range.openToMs))
  );
  const closed = or(
    and(
      isNotNull(tasks.completedAt),
      gte(tasks.completedAt, new Date(range.closedFromMs)),
      lt(tasks.completedAt, new Date(range.closedToMs))
    ),
    and(
      isNotNull(tasks.abortedAt),
      gte(tasks.abortedAt, new Date(range.closedFromMs)),
      lt(tasks.abortedAt, new Date(range.closedToMs))
    )
  );
  const rows = db
    .select({
      id: tasks.id,
      title: tasks.title,
      kind: tasks.kind,
      category: tasks.category,
      relatedEventTable: tasks.relatedEventTable,
      scheduledFor: tasks.scheduledFor,
      completedAt: tasks.completedAt,
      abortedAt: tasks.abortedAt,
      assigneeUserId: tasks.assigneeUserId,
      supersededByTaskId: tasks.supersededByTaskId,
      blockId: tasks.blockId
    })
    .from(tasks)
    .where(withTenant(tasks, or(open, closed)))
    .all()
    .filter((r) => !r.supersededByTaskId);
  const blockIds = [...new Set(rows.flatMap((r) => (r.blockId ? [r.blockId] : [])))];
  const blockName = new Map<string, string>();
  for (let i = 0; i < blockIds.length; i += 500) {
    for (const b of db
      .select({ id: blocks.id, name: blocks.name })
      .from(blocks)
      .where(withTenant(blocks, inArray(blocks.id, blockIds.slice(i, i + 500))))
      .all()) {
      blockName.set(b.id, b.name);
    }
  }
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    kind: r.kind,
    category: r.category ?? null,
    scheduledFor: r.scheduledFor.getTime(),
    completedAt: r.completedAt?.getTime() ?? null,
    abortedAt: r.abortedAt?.getTime() ?? null,
    assigneeUserId: r.assigneeUserId ?? null,
    isSpray: isSprayTask(r),
    where: r.blockId ? (blockName.get(r.blockId) ?? null) : null
  }));
}

export function listDigestTime(fromMs: number, toMs: number): DigestTimeEntry[] {
  return db
    .select({
      userId: taskTimeEntries.userId,
      minutes: taskTimeEntries.minutes,
      startedAt: taskTimeEntries.startedAt,
      createdAt: taskTimeEntries.createdAt
    })
    .from(taskTimeEntries)
    .where(
      withTenant(
        taskTimeEntries,
        or(
          and(
            isNotNull(taskTimeEntries.startedAt),
            gte(taskTimeEntries.startedAt, new Date(fromMs)),
            lt(taskTimeEntries.startedAt, new Date(toMs))
          ),
          and(
            isNull(taskTimeEntries.startedAt),
            gte(taskTimeEntries.createdAt, new Date(fromMs)),
            lt(taskTimeEntries.createdAt, new Date(toMs))
          )
        )
      )
    )
    .all()
    .map((r) => ({
      userId: r.userId ?? null,
      minutes: r.minutes,
      atMs: (r.startedAt ?? r.createdAt).getTime()
    }));
}

/** Live ledger entries in a range, for the owner's Monday email (F4-5).
 *  No derived costs. */
export function listDigestLedger(
  fromMs: number,
  toMs: number
): { kind: 'income' | 'expense'; amountCents: number; occurredAt: number }[] {
  return db
    .select({
      kind: ledgerEntries.kind,
      amountCents: ledgerEntries.amountCents,
      occurredAt: ledgerEntries.occurredAt
    })
    .from(ledgerEntries)
    .where(
      withTenant(
        ledgerEntries,
        and(
          isNull(ledgerEntries.deletedAt),
          gte(ledgerEntries.occurredAt, new Date(fromMs)),
          lt(ledgerEntries.occurredAt, new Date(toMs))
        )
      )
    )
    .all()
    .map((e) => ({ kind: e.kind, amountCents: e.amountCents, occurredAt: e.occurredAt.getTime() }));
}

/** `memberName` for each of these users (F0-12). */
export function memberNames(userIds: readonly string[]): Record<string, string> {
  const out: Record<string, string> = {};
  if (userIds.length === 0) return out;
  for (const u of db
    .select({
      id: users.id,
      email: users.email,
      phone: users.phone,
      displayName: users.displayName
    })
    .from(users)
    .where(inArray(users.id, [...userIds]))
    .all()) {
    out[u.id] = memberName(u);
  }
  return out;
}

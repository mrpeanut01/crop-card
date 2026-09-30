/**
 * Phase 32F (F4-8). Turns rows the /today loader already holds into the
 * Monday card's input. No reads of its own (F0-8).
 */

import type { TodayDigestInput } from '$lib/today/advice';
import { isSprayTask, type DigestTask } from './weekly';

export interface TodayTaskLike {
  id: string;
  title: string;
  scheduledFor: number;
  completedAt?: number | null;
  abortedAt?: number | null;
  blockId?: string | null;
  category?: string | null;
  relatedEventTable?: string | null;
  /** Present once task rows carry their assignee (F1-9). */
  assigneeUserId?: string | null;
  assignee?: { id: string; name: string } | null;
}

export function toDigestTask(
  t: TodayTaskLike,
  blockNameById: ReadonlyMap<string, string>
): DigestTask {
  return {
    id: t.id,
    title: t.title,
    scheduledFor: t.scheduledFor,
    completedAt: t.completedAt ?? null,
    abortedAt: t.abortedAt ?? null,
    assigneeUserId: t.assigneeUserId ?? t.assignee?.id ?? null,
    assigneeName: t.assignee?.name ?? null,
    isSpray: isSprayTask(t),
    where: t.blockId ? (blockNameById.get(t.blockId) ?? null) : null
  };
}

export function todayDigestInput(input: {
  openPrimaries: readonly TodayTaskLike[];
  careOpen: readonly TodayTaskLike[];
  lowStockCount: number;
  blockNameById: ReadonlyMap<string, string>;
  viewerId: string;
  isOwner: boolean;
  viewerTimeZone?: string;
}): TodayDigestInput {
  return {
    openTasks: input.openPrimaries.map((t) => toDigestTask(t, input.blockNameById)),
    careDue: input.careOpen.map((t) => ({
      ...toDigestTask(t, input.blockNameById),
      isSpray: false
    })),
    lowStockCount: input.lowStockCount,
    viewerId: input.viewerId,
    isOwner: input.isOwner,
    viewerTimeZone: input.viewerTimeZone
  };
}

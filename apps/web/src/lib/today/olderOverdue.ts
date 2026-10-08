/** #742: the Day deck loads a window starting `fromMs`; open tasks due
 *  before it are still overdue, so they join the deck (oldest first) from
 *  the open-task list the loader already has. */
export function withOlderOverdue<T extends { id: string; scheduledFor: number }>(
  windowTasks: readonly T[],
  openTasks: readonly T[],
  fromMs: number
): T[] {
  const seen = new Set(windowTasks.map((t) => t.id));
  const older = openTasks.filter((t) => t.scheduledFor < fromMs && !seen.has(t.id));
  return [...older.sort((a, b) => a.scheduledFor - b.scheduledFor), ...windowTasks];
}

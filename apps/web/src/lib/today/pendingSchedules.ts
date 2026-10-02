/** Suggestions scheduled on this phone that the server has not seen yet
 *  (Phase 34A, SO-06 to SO-08). Pure, so the Day deck and the suggestion
 *  badges agree on which rows still count as waiting. */

export interface PendingScheduleLike {
  rowId: string;
  title: string;
  scheduledFor: number;
  blockId?: string;
  cropId?: string;
  pluginTemplateKey: string;
  rejected: boolean;
}

/** Waiting rows to show: not rejected, not already a task in server data,
 *  one per suggestion key, soonest first. */
export function pendingSchedules<R extends PendingScheduleLike>(
  rows: readonly R[],
  serverKeys: ReadonlySet<string>
): R[] {
  const seen = new Set<string>();
  const out: R[] = [];
  for (const r of rows) {
    if (r.rejected || serverKeys.has(r.pluginTemplateKey) || seen.has(r.pluginTemplateKey)) {
      continue;
    }
    seen.add(r.pluginTemplateKey);
    out.push(r);
  }
  return out.sort((a, b) => a.scheduledFor - b.scheduledFor || a.rowId.localeCompare(b.rowId));
}

/** Template keys of the server's tasks, from whatever task lists a view
 *  loaded plus the keys the loader already knows are scheduled. */
export function serverTemplateKeys(
  tasks: readonly { pluginTemplateKey?: string | null }[],
  extra: readonly string[] = []
): Set<string> {
  const out = new Set<string>(extra);
  for (const t of tasks) if (t.pluginTemplateKey) out.add(t.pluginTemplateKey);
  return out;
}

/** The Mine filter shows only tasks given to the viewer, so a pending
 *  schedule (never assigned) shows only under Everyone, like an unassigned
 *  task. */
export function pendingForWho<R>(
  pending: readonly R[],
  who: 'mine' | 'all'
): { shown: R[]; hiddenCount: number } {
  return who === 'all'
    ? { shown: [...pending], hiddenCount: 0 }
    : { shown: [], hiddenCount: pending.length };
}

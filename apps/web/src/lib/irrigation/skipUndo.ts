/** Who may undo a logged waterer skip (#870, FU870-2). Client-safe, so the
 *  route and the cards that show an Undo button agree. Mirrors task time
 *  (`timeDeleteVerdict`): owners undo any skip at any time; the person who
 *  logged it, within 48 hours of the server's save time; inspectors never. */

export const SKIP_UNDO_WINDOW_MS = 48 * 60 * 60 * 1000;

export type SkipUndoVerdict = 'ok' | 'READ_ONLY' | 'NOT_YOURS' | 'TOO_LATE';

export function skipUndoVerdict(
  skip: { createdBy: string | null; createdAt: number },
  user: { id: string; role: string },
  now: number
): SkipUndoVerdict {
  if (user.role === 'owner') return 'ok';
  if (user.role === 'inspector') return 'READ_ONLY';
  if (skip.createdBy === null || skip.createdBy !== user.id) return 'NOT_YOURS';
  if (now - skip.createdAt > SKIP_UNDO_WINDOW_MS) return 'TOO_LATE';
  return 'ok';
}

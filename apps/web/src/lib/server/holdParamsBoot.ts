import { backfillHoldParamsEverywhere } from './holdGuard';
import { isFenced, trackMutation } from './ops/handoff';

const BOOT_KEY = Symbol.for('cropcard.holdParamsBootBackfill');

/**
 * C-35 §2 (review round 7): the shared plugin library ships in the image,
 * so a deploy can change it with no in-app writer running the snapshot
 * backfill first. Each boot therefore gives every record that still has no
 * hold-parameter snapshot (saved before C-35) the data this image ships,
 * so the next deploy's data change can only lengthen its holds, the same
 * floor a record saved now gets. Non-blocking; skipped under tests, while
 * the deploy handoff fence is up, and with `HOLD_BACKFILL=off`.
 */
export function scheduleBootHoldBackfill(
  env: Record<string, string | undefined> = process.env,
  delayMs = 1_000,
  run: () => Promise<number> = () => backfillHoldParamsEverywhere()
): boolean {
  if (env.NODE_ENV === 'test' || env.VITEST === 'true' || env.HOLD_BACKFILL === 'off') {
    return false;
  }
  const g = globalThis as Record<symbol, boolean | undefined>;
  if (g[BOOT_KEY]) return false;
  g[BOOT_KEY] = true;
  const t = setTimeout(() => {
    if (isFenced()) return;
    trackMutation(run).then(
      (written) => console.log('[hold-params] boot backfill', JSON.stringify({ written })),
      (err) => console.error('[hold-params] boot backfill failed', err)
    );
  }, delayMs);
  t.unref?.();
  return true;
}

/** Test-only reset of the once-per-process flag. */
export function _resetHoldBackfillBootForTests(): void {
  delete (globalThis as Record<symbol, boolean | undefined>)[BOOT_KEY];
}

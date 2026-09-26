export interface SendWindow {
  ms: number;
  max: number;
}

/** In-process sliding-window limiter. Exact because Invariant 3 keeps a
 *  single replica; a restart only forgets recent sends, never blocks. */
export function createSendLimiter(windows: readonly SendWindow[]) {
  const sends = new Map<string, number[]>();
  const longest = Math.max(...windows.map((w) => w.ms));
  return {
    /** Records the send and returns true when every window has room. */
    tryTake(key: string, now = Date.now()): boolean {
      const recent = (sends.get(key) ?? []).filter((t) => now - t < longest);
      const full = windows.some((w) => recent.filter((t) => now - t < w.ms).length >= w.max);
      if (full) {
        sends.set(key, recent);
        return false;
      }
      recent.push(now);
      sends.set(key, recent);
      return true;
    },
    reset(): void {
      sends.clear();
    }
  };
}

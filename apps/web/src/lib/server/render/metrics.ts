import { AsyncLocalStorage } from 'node:async_hooks';

export type RenderMode = 'thread' | 'inline';

/** Per-interval render counters for the `[perf]` line (R-13). */
export const renderCounters = { jobs: 0, ms: 0, busy: 0 };

let lastMode: RenderMode | null = null;

export function noteRenderMode(mode: RenderMode): void {
  lastMode = mode;
}

export function renderModeInUse(): RenderMode | null {
  return lastMode;
}

export interface RequestRenderTiming {
  ms: number;
  mode: RenderMode | null;
}

/** Render time spent for the current request, read by `withServerTiming`. */
export const renderTimingStore = new AsyncLocalStorage<RequestRenderTiming>();

export function runWithRenderTiming<T>(fn: () => T): { timing: RequestRenderTiming; result: T } {
  const timing: RequestRenderTiming = { ms: 0, mode: null };
  return { timing, result: renderTimingStore.run(timing, fn) };
}

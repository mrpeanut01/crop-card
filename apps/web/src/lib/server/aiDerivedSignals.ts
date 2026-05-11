/**
 * Phase 17 (Track 3.3) — shared derived-signal store for the AI planning
 * endpoints (`suggest`, `optimize`, `allocate`, `groups`).
 *
 * Today every endpoint independently re-derives the same expensive
 * intermediate facts: density signals per draft crop, the (seed × block)
 * candidacy matrix, viable-window math per crop. A user moving from
 * `allocate` → `groups` pays the recomputation twice.
 *
 * This store keys those derived facts on the same content-hash that
 * `aiContextCache.ts` produces. When the underlying farm state changes,
 * the contextVersion changes, and stale signals fall out automatically —
 * no separate invalidation logic to keep in sync.
 *
 * The store is per-process and intentionally small. It exists to thread
 * facts BETWEEN endpoints within a single planning session, not to
 * persist them across deploys.
 */

const TTL_MS = 10 * 60 * 1000;
const MAX_ENTRIES_PER_VERSION = 16;

/**
 * Names of the well-known derived signals the planning code currently
 * recomputes redundantly. Adding a new signal kind is a string + a
 * caller; no schema change.
 */
export type DerivedSignalKind =
  | 'density-per-draft'
  | 'candidacy-matrix'
  | 'viable-windows'
  | 'rotation-history';

interface SignalEntry<T = unknown> {
  contextVersion: string;
  kind: DerivedSignalKind;
  /** Optional sub-key when one kind has multiple slices (e.g.,
   *  density-per-draft computed from a specific draft set hash). */
  subKey: string;
  payload: T;
  storedAt: number;
  hits: number;
}

const store = new Map<string, SignalEntry>();
const stats = {
  hits: 0,
  misses: 0,
  evictions: 0
};

function key(contextVersion: string, kind: DerivedSignalKind, subKey: string): string {
  return `${contextVersion}::${kind}::${subKey}`;
}

/**
 * Look up a derived signal computed against `contextVersion`. Returns
 * null on miss or expired entry.
 */
export function getDerivedSignal<T>(
  contextVersion: string,
  kind: DerivedSignalKind,
  subKey: string = '_'
): T | null {
  const k = key(contextVersion, kind, subKey);
  const entry = store.get(k);
  if (!entry) {
    stats.misses++;
    return null;
  }
  if (Date.now() - entry.storedAt > TTL_MS) {
    store.delete(k);
    stats.misses++;
    return null;
  }
  entry.hits++;
  stats.hits++;
  return entry.payload as T;
}

/**
 * Store a derived signal. Caller is responsible for confirming the
 * payload was computed against this exact `contextVersion`.
 */
export function setDerivedSignal<T>(
  contextVersion: string,
  kind: DerivedSignalKind,
  payload: T,
  subKey: string = '_'
): void {
  const k = key(contextVersion, kind, subKey);
  store.set(k, {
    contextVersion,
    kind,
    subKey,
    payload,
    storedAt: Date.now(),
    hits: 0
  });
  evictOldVersions(contextVersion);
}

/**
 * Convenience: get-or-compute. The compute fn runs only on cache miss,
 * its result is stored, and returned. Use this from any endpoint that
 * wants free signal sharing without managing the get/set dance.
 */
export async function getOrComputeDerivedSignal<T>(
  contextVersion: string,
  kind: DerivedSignalKind,
  compute: () => T | Promise<T>,
  subKey: string = '_'
): Promise<T> {
  const cached = getDerivedSignal<T>(contextVersion, kind, subKey);
  if (cached !== null) return cached;
  const payload = await compute();
  setDerivedSignal(contextVersion, kind, payload, subKey);
  return payload;
}

export function clearDerivedSignals(): void {
  store.clear();
  stats.hits = 0;
  stats.misses = 0;
  stats.evictions = 0;
}

export function getDerivedSignalStats(): {
  size: number;
  hits: number;
  misses: number;
  evictions: number;
  hitRatio: number;
  byKind: Record<DerivedSignalKind, number>;
} {
  const total = stats.hits + stats.misses;
  const byKind: Record<string, number> = {};
  for (const e of store.values()) {
    byKind[e.kind] = (byKind[e.kind] ?? 0) + 1;
  }
  return {
    size: store.size,
    hits: stats.hits,
    misses: stats.misses,
    evictions: stats.evictions,
    hitRatio: total === 0 ? 0 : stats.hits / total,
    byKind: byKind as Record<DerivedSignalKind, number>
  };
}

/**
 * When a new entry is written for a given contextVersion, drop the
 * oldest entries for OTHER versions if we're over budget per version.
 * Keeps the store small without thrashing the active session.
 */
function evictOldVersions(activeVersion: string): void {
  // Count entries per version; if any other version has too many, drop oldest.
  const perVersion = new Map<string, SignalEntry[]>();
  for (const e of store.values()) {
    const list = perVersion.get(e.contextVersion) ?? [];
    list.push(e);
    perVersion.set(e.contextVersion, list);
  }
  for (const [v, list] of perVersion) {
    if (v === activeVersion) continue;
    if (list.length <= MAX_ENTRIES_PER_VERSION) continue;
    const sorted = list.sort((a, b) => a.storedAt - b.storedAt);
    const overflow = sorted.length - MAX_ENTRIES_PER_VERSION;
    for (let i = 0; i < overflow; i++) {
      store.delete(key(v, sorted[i].kind, sorted[i].subKey));
      stats.evictions++;
    }
  }
}

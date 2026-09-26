/**
 * Keep-apart and good-neighbour relations read from companion plugins. The
 * garden designer, the layout engine input and the allocation endpoints all
 * go through here so they agree on what a plugin means:
 *
 * - `goodWith`: every listed crop is a good neighbour of every other.
 * - `badWith`: every listed crop is a keep-apart pair with every other.
 * - `keepApart[]`: a crop on side `a` and a crop on side `b` are a keep-apart
 *   pair; two crops on the same side never are.
 *
 * Client-safe (no node imports).
 */

import type { CompanionPlugin } from './schemas';

export type CompanionRelationSource = Pick<
  CompanionPlugin,
  'pluginId' | 'goodWith' | 'badWith' | 'keepApart' | 'benefit'
>;

export interface KeepApartMatch {
  /** The keepApart entry's reason, or the plugin's `benefit` line for a
   *  `badWith` pair. */
  reason: string | null;
  source: string | null;
}

/** Why `x` and `y` should be kept apart under companion plugin `c`, or null
 *  when they need not be. A crop never pairs with itself. */
export function keepApartMatch(
  c: CompanionRelationSource,
  x: string,
  y: string
): KeepApartMatch | null {
  if (x === y) return null;
  for (const k of c.keepApart ?? []) {
    if ((k.a.includes(x) && k.b.includes(y)) || (k.a.includes(y) && k.b.includes(x))) {
      return { reason: k.reason, source: k.source ?? null };
    }
  }
  const bad = c.badWith ?? [];
  if (bad.includes(x) && bad.includes(y)) return { reason: c.benefit ?? null, source: null };
  return null;
}

export interface CompanionEntry {
  goodWith: string[];
  badWith: string[];
}

/** Per-crop partner lists for the layout engine and allocator
 *  (`PlanInput['companions']`). Symmetric: if y is in x's list, x is in y's. */
export function companionIndex(
  companions: readonly CompanionRelationSource[]
): Record<string, CompanionEntry> {
  const good = new Map<string, Set<string>>();
  const bad = new Map<string, Set<string>>();
  const link = (m: Map<string, Set<string>>, x: string, y: string) => {
    if (x === y) return;
    let sx = m.get(x);
    if (!sx) m.set(x, (sx = new Set()));
    sx.add(y);
    let sy = m.get(y);
    if (!sy) m.set(y, (sy = new Set()));
    sy.add(x);
  };
  for (const c of companions) {
    const g = c.goodWith ?? [];
    for (let i = 0; i < g.length; i++)
      for (let j = i + 1; j < g.length; j++) link(good, g[i], g[j]);
    const b = c.badWith ?? [];
    for (let i = 0; i < b.length; i++) for (let j = i + 1; j < b.length; j++) link(bad, b[i], b[j]);
    for (const k of c.keepApart ?? []) for (const x of k.a) for (const y of k.b) link(bad, x, y);
  }
  const out: Record<string, CompanionEntry> = {};
  for (const id of new Set([...good.keys(), ...bad.keys()])) {
    out[id] = { goodWith: [...(good.get(id) ?? [])], badWith: [...(bad.get(id) ?? [])] };
  }
  return out;
}

/** keepApart members that don't name a crop plugin, for a load-time warning. */
export function unresolvedKeepApartIds(
  companions: readonly CompanionRelationSource[],
  isCrop: (pluginId: string) => boolean
): { pluginId: string; cropPluginId: string }[] {
  const out: { pluginId: string; cropPluginId: string }[] = [];
  for (const c of companions) {
    const seen = new Set<string>();
    for (const k of c.keepApart ?? []) {
      for (const id of [...k.a, ...k.b]) {
        if (seen.has(id) || isCrop(id)) continue;
        seen.add(id);
        out.push({ pluginId: c.pluginId, cropPluginId: id });
      }
    }
  }
  return out;
}

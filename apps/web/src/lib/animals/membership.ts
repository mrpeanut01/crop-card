/**
 * C-15: which groups an animal belonged to, and when, rebuilt from its
 * location rows. `animals.group_id` is only the current group; every join
 * and leave is on `animal_locations.from_group_id` / `to_group_id`
 * (migration 0069). Pure, so the rebuild is property-tested; the
 * tenant-scoped reads stay in the callers.
 */

import type { GroupMembership } from '$lib/safety/animalWithdrawal';

export interface MembershipStay {
  fromMs: number;
  toMs: number | null;
  fromGroupId: string | null;
  toGroupId: string | null;
  createdAt?: number;
}

interface Change {
  atMs: number;
  order: number;
  from: string | null;
  to: string | null;
}

/** Group changes in time order. A stay that starts with `fromGroupId` left
 *  that group when it began; a stay ending with `toGroupId` joined it when
 *  it ended; a zero-length marker does both at once. */
function changesOf(stays: readonly MembershipStay[]): Change[] {
  const out: Change[] = [];
  stays.forEach((s, i) => {
    const marker = s.toMs !== null && s.toMs === s.fromMs;
    if (marker) {
      if (s.fromGroupId || s.toGroupId) {
        out.push({ atMs: s.fromMs, order: i, from: s.fromGroupId, to: s.toGroupId });
      }
      return;
    }
    if (s.fromGroupId) out.push({ atMs: s.fromMs, order: i, from: s.fromGroupId, to: null });
    if (s.toGroupId && s.toMs !== null) {
      out.push({ atMs: s.toMs, order: i + 0.5, from: null, to: s.toGroupId });
    }
  });
  return out.sort((a, b) => a.atMs - b.atMs || a.order - b.order);
}

/**
 * Memberships of one animal, walking back from its current group. Each
 * change closes the later membership and opens the earlier one. When a
 * record names a group the walk did not expect, both readings are kept, so
 * a gap in the history can only widen what the animal was part of.
 */
export function membershipsFromStays(
  currentGroupId: string | null,
  stays: readonly MembershipStay[]
): GroupMembership[] {
  const changes = changesOf(stays);
  const out: GroupMembership[] = [];
  let group = currentGroupId;
  let endMs: number | null = null;
  for (let i = changes.length - 1; i >= 0; i--) {
    const c = changes[i];
    if (c.to && c.to !== group) {
      out.push({ groupId: c.to, fromMs: c.atMs, toMs: endMs });
    }
    if (group) out.push({ groupId: group, fromMs: c.atMs, toMs: endMs });
    group = c.from;
    endMs = c.atMs;
  }
  if (group) out.push({ groupId: group, fromMs: null, toMs: endMs });
  return out.reverse();
}

/**
 * The groups a group split from (B-07), with the window over which it
 * carries their treatments: everything before the split. `parentLineage`
 * resolves a parent's own ancestry. A parent reached twice is walked again
 * only when the later path reaches further, so a cycle in the history ends
 * and the widest window is kept. `selfId` leaves the group out of its own
 * lineage.
 */
export function lineageFromStays(
  stays: readonly MembershipStay[],
  parentLineage: (groupId: string) => readonly MembershipStay[],
  selfId?: string
): GroupMembership[] {
  const reach = new Map<string, number>();
  const walk = (rows: readonly MembershipStay[], untilMs: number | null) => {
    for (const s of rows) {
      const parent = s.fromGroupId;
      if (!parent || parent === selfId) continue;
      const cut = untilMs === null ? s.fromMs : Math.min(untilMs, s.fromMs);
      const seen = reach.get(parent);
      if (seen !== undefined && seen >= cut) continue;
      reach.set(parent, cut);
      walk(parentLineage(parent), cut);
    }
  };
  walk(stays, null);
  return [...reach].map(([groupId, toMs]) => ({ groupId, fromMs: null, toMs }));
}

/**
 * Round 7: an animal's memberships plus, for each group it was in, that
 * group's split ancestry carried down to it. A named animal in a group
 * split off a treated flock carries the flock's treatments given before the
 * split for as long as it is in the split-off group, the way the group
 * itself does, and the flock's stays up to the split. Each carried entry
 * keeps the member's window and marks the split with `inheritedUntilMs`.
 */
export function withInheritedLineage(
  memberships: readonly GroupMembership[],
  lineageOf: (groupId: string) => readonly GroupMembership[]
): GroupMembership[] {
  const out: GroupMembership[] = [...memberships];
  const cache = new Map<string, readonly GroupMembership[]>();
  for (const w of memberships) {
    if (w.inheritedUntilMs !== undefined) continue;
    let lineage = cache.get(w.groupId);
    if (!lineage) {
      lineage = lineageOf(w.groupId);
      cache.set(w.groupId, lineage);
    }
    for (const l of lineage) {
      if (l.toMs === null || l.groupId === w.groupId) continue;
      out.push({ groupId: l.groupId, fromMs: w.fromMs, toMs: w.toMs, inheritedUntilMs: l.toMs });
    }
  }
  return out;
}

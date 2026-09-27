/** One way to count a group, shared by the list, detail pages, the Area Card
 *  and later the Flock Card. `head_count` holds only the unnamed members;
 *  named individuals are counted from their own rows, and only while they
 *  are active, so an individual joining or leaving never double counts. */

export interface GroupCountInput {
  headCount: number | null;
}

export interface MemberCountInput {
  status: string;
  foodProducing?: boolean;
}

export function activeMembers<T extends MemberCountInput>(members: readonly T[]): T[] {
  return members.filter((m) => m.status === 'active');
}

export function groupTotal(group: GroupCountInput, members: readonly MemberCountInput[]): number {
  return Math.max(0, group.headCount ?? 0) + activeMembers(members).length;
}

/** The value the kernel reads: the group's own flag, or any active member's,
 *  whichever is stricter. Never derived from `purpose`. */
export function effectiveGroupFoodProducing(
  group: { foodProducing: boolean },
  members: readonly MemberCountInput[]
): boolean {
  return group.foodProducing || activeMembers(members).some((m) => m.foodProducing === true);
}

export interface CapacityState {
  capacity: number;
  count: number;
  over: boolean;
}

/** Owner-typed capacity is advisory: over capacity is shown, never blocked. */
export function capacityState(capacity: unknown, count: number): CapacityState | null {
  if (typeof capacity !== 'number' || !Number.isFinite(capacity) || capacity <= 0) return null;
  return { capacity, count, over: count > capacity };
}

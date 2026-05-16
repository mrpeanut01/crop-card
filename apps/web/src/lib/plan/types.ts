/**
 * Shared plan types crossed by allocation + scheduling phases.
 *
 * Both the allocator (UC-37) and the scheduler (Phase 20) consume the same
 * `PollinationConstraint[]` shape, so it lives here rather than inside one
 * endpoint's server module. Keep this file dependency-free (types only).
 */

/** A single cross-pollination consideration produced by the allocator. */
export interface PollinationConstraint {
  /** Stable kind tag so callers can filter without parsing prose. */
  kind: 'isolated-spatially' | 'must-stagger' | 'geometry-missing';
  /** The two stockItemIds in the crossing pair. Sorted for stable equality. */
  pair: [string, string];
  /** Variety names — used by the UI to render chips without re-joining the
   *  seed list. */
  pairDisplayNames: [string, string];
  /** The two blockIds the allocator placed the pair on. May be the same id
   *  when both varieties landed on one block (which is the worst case for a
   *  crossing pair — pure temporal stagger required). */
  blockIds: [string, string];
  blockNames: [string, string];
  /** Centroid distance in feet. `null` when geometry was missing. */
  distanceFt: number | null;
  /** The home-scale isolation threshold for this pair (max of both plugins). */
  requiredIsolationFeet: number;
  /** When `kind === 'must-stagger'`, the minimum days between flowering
   *  windows. The scheduler turns this into a date delta. */
  staggerDays: number;
  /** One plain-English sentence the UI renders next to the row. */
  note: string;
}

/** Marker the allocator can carry through to the scheduler — e.g., a
 *  three-sisters grouping discovered at allocation time. Phase B6 consumes
 *  this to anchor + offset planting dates without re-discovery. */
export interface CompanionGroupMarker {
  /** Stable key — `${blockId}:${seedItemIdAnchor}`. */
  groupId: string;
  /** Plugin family of the anchor crop (corn for 3-sisters). */
  anchorFamily: string;
  /** Members of the group as `{stockItemId, role}` — anchor and companions. */
  members: Array<{
    stockItemId: string;
    role: 'anchor' | 'companion';
    /** Days from anchor planting date (0 for the anchor itself, +14 for
     *  beans in 3-sisters, +35 for squash). Filled in by the allocator
     *  using the shared companion-offset table. */
    daysFromAnchor: number;
  }>;
}

/** Phase 19 — Allocation extension. Lives alongside the existing fields on
 *  `AllocationResponse` so consumers can opt-in without breaking older
 *  clients. */
export interface AllocationConstraints {
  pollination: PollinationConstraint[];
  companionGroups: CompanionGroupMarker[];
  /** Set of blockIds the allocator could not evaluate spatially because
   *  geometry was missing. The wizard surfaces this as a one-time banner
   *  ("Pollination check skipped for N blocks — add field geometry to
   *  enable"). */
  geometryMissingBlockIds: string[];
}

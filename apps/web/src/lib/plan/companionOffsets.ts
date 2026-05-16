/**
 * Companion offset utilities shared by allocation + scheduling (Phase 20, B6).
 *
 * The data lives in companion plugins under `plugins/companions/*.json` —
 * each system declares a `primaryFamily` (anchor) and a list of `members`
 * with `family` + `plantingOffsetDays`. This module exposes:
 *
 *   - `detectCompanionGroups(assignments, pluginIndex, companionSystems)`:
 *     given a finalized allocation, find sets of (assignments on one block)
 *     that match a companion system (e.g. corn + beans + squash all on
 *     Block C ⇒ three-sisters group). Used by the allocator to mark
 *     `CompanionGroupMarker[]` for carry-forward.
 *
 *   - `offsetForFamily(group, family)`: lookup the days-from-anchor offset
 *     for a given family inside a detected group. The scheduler uses this
 *     to anchor on the corn date and offset beans/squash.
 *
 * Pure functions; no DB / no AI. Same data source as `calendar/companions.ts`
 * so the swim-lane group flow and the scheduler don't diverge.
 */

import type { CompanionPlugin, CropPlugin } from '$lib/plugins/schemas';
import type { CompanionGroupMarker } from './types';

export interface CompanionAssignment {
  stockItemId: string;
  blockId: string;
  cropPluginId: string;
}

/**
 * Detect companion groupings present in the finalized allocation. A group
 * exists when every member family of a companion system is represented by
 * at least one assignment on the same block.
 */
export function detectCompanionGroups(
  assignments: ReadonlyArray<CompanionAssignment>,
  pluginIndex: Record<string, CropPlugin>,
  companionSystems: ReadonlyArray<CompanionPlugin>
): CompanionGroupMarker[] {
  const out: CompanionGroupMarker[] = [];
  const seen = new Set<string>();
  const byBlock = new Map<string, CompanionAssignment[]>();
  for (const a of assignments) {
    const list = byBlock.get(a.blockId) ?? [];
    list.push(a);
    byBlock.set(a.blockId, list);
  }

  for (const [blockId, items] of byBlock) {
    for (const sys of companionSystems) {
      if (!sys.primaryFamily || !sys.members?.length) continue;
      const anchorAssign = items.find((a) => {
        const plug = pluginIndex[a.cropPluginId];
        return plug?.cropFamily === sys.primaryFamily;
      });
      if (!anchorAssign) continue;

      const memberPicks: Array<{ stockItemId: string; family: string; offsetDays: number }> = [];
      let allFound = true;
      for (const m of sys.members) {
        const found = items.find((a) => {
          const plug = pluginIndex[a.cropPluginId];
          return plug?.cropFamily === m.family && a.stockItemId !== anchorAssign.stockItemId;
        });
        if (!found) {
          allFound = false;
          break;
        }
        memberPicks.push({
          stockItemId: found.stockItemId,
          family: m.family,
          offsetDays: m.plantingOffsetDays
        });
      }
      if (!allFound) continue;

      const groupId = `${blockId}:${anchorAssign.stockItemId}`;
      if (seen.has(groupId)) continue;
      seen.add(groupId);
      out.push({
        groupId,
        anchorFamily: sys.primaryFamily,
        members: [
          { stockItemId: anchorAssign.stockItemId, role: 'anchor', daysFromAnchor: 0 },
          ...memberPicks.map((m) => ({
            stockItemId: m.stockItemId,
            role: 'companion' as const,
            daysFromAnchor: m.offsetDays
          }))
        ]
      });
    }
  }
  return out;
}

/** Lookup helper for the scheduler — returns the days-from-anchor offset
 *  for a given stockItemId within a detected group, or null if not a member. */
export function offsetForStockInGroup(
  group: CompanionGroupMarker,
  stockItemId: string
): number | null {
  const m = group.members.find((x) => x.stockItemId === stockItemId);
  return m ? m.daysFromAnchor : null;
}

/** The anchor stockItemId for a group (always the first 'anchor' role). */
export function anchorStockInGroup(group: CompanionGroupMarker): string | null {
  const anchor = group.members.find((m) => m.role === 'anchor');
  return anchor ? anchor.stockItemId : null;
}

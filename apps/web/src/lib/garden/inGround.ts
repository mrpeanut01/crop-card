/**
 * Whether a planting is already in the ground. In this app `active` means
 * "scheduled" (a dated plan or a succession sowing gets it before anything
 * happens), so the status alone can't say whether seed went in. A planting
 * counts as in the ground once its date has come, a harvest was recorded,
 * or it was closed out. Plans with a future date stay movable and a bed
 * holding only plans can still be deleted.
 */

import { shortDate } from './occupancy';
import type { PlantingStatus } from './types';

export interface GroundFacts {
  status: PlantingStatus | string;
  plantingDateMs: number | null;
  harvestedAtMs: number | null;
}

export function plantingInGround(p: GroundFacts, nowMs: number): boolean {
  if (p.status === 'planned') return false;
  if (p.harvestedAtMs != null) return true;
  if (p.status !== 'active') return true;
  return p.plantingDateMs == null || p.plantingDateMs <= nowMs;
}

/** "Planned for May 15", "Growing", "Harvested" and so on, for a planting
 *  row. `stage` is the designer's stage on the scrubbed date, when known. */
export function plantingStatusText(
  p: GroundFacts,
  nowMs: number,
  stage?: 'Growing' | 'Harvesting' | null
): string {
  if (p.status === 'harvested') return 'Harvested';
  if (p.status === 'failed') return 'Failed';
  if (p.status === 'archived') return 'Archived';
  if (!plantingInGround(p, nowMs)) {
    return p.plantingDateMs != null ? `Planned for ${shortDate(p.plantingDateMs)}` : 'Not dated';
  }
  return stage ?? 'In the ground';
}

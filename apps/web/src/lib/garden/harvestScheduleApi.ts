/** Phase 37C `GET /api/garden/harvest-schedule` contract. Client-safe, so
 *  the OpenAPI generator and `HarvestSchedulePanel` share it. */

import { z } from 'zod';
import type { CutKind, GoalLine, ScheduleEnd } from './harvestSchedule';
import type { PreservingMethod, PreservingSuitability } from './preserving';
import type { HarvestTimingHint } from './harvestTiming';

export const harvestScheduleQuerySchema = z.strictObject({
  areaId: z
    .string()
    .min(1)
    .max(128)
    .optional()
    .describe('Only plantings in this Area. Without it, every herb planting on the farm.')
});

export interface ScheduleCutView {
  plantingId: string;
  cropPluginId: string;
  cropName: string;
  blockName: string;
  kind: CutKind;
  fromMs: number;
  toMs: number;
  provenance: 'plugin' | 'fallback';
}

export interface SchedulePlantingView {
  plantingId: string;
  cropPluginId: string;
  cropName: string;
  blockName: string;
  endsAt: ScheduleEnd;
  firstWindowOnly: boolean;
  cutCount: number;
  nextCut: { fromMs: number; week: string } | null;
  /** An infuse row carries its food-safety line as `note` (the gate makes
   *  sure of it). */
  preserving: Array<{
    method: PreservingMethod;
    suitability: PreservingSuitability;
    note?: string;
  }>;
  /** #867: when to cut for each method the brief's goals name, from the
   *  crop's sourced `harvestTiming`; empty when none applies. */
  timing: HarvestTimingHint[];
}

export interface HarvestScheduleResponse {
  year: number;
  weeks: Array<{ week: string; cuts: ScheduleCutView[] }>;
  plantings: SchedulePlantingView[];
  goals: GoalLine[];
}

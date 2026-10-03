import type { CompanionGroupMarker, PollinationConstraint } from '$lib/plan/types';

export type SeedStockEntry = {
  stockItemId: string;
  displayName: string;
  /** Phase 15d — short label; falls back to displayName when absent. */
  shortName?: string;
  onHand: number;
  /** #475 — quantity on `ordered` lots (not received yet). */
  onOrder?: number;
  /** #475 — quantity on `planned` lots (not bought yet). */
  planned?: number;
  defaultUnit: string;
  cropPluginId: string | null;
  cropFamily: string | null;
};

export type BlockEntry = {
  id: string;
  name: string;
  blockLabel?: string;
  acres?: number;
  sunExposure?: 'full' | 'partial' | 'shade';
  /** #475 — sketch size, edited inline on the Blocks step. */
  widthFt?: number;
  lengthFt?: number;
  plantings: Array<{ varietyDisplayName: string }>;
  /** The Area the block sits in, so the wizard can call garden beds "beds". */
  fieldId?: string | null;
};

/** A block the plan can size seed to: typed width and length, or an area
 *  (typed, or measured from a drawn shape). */
export function blockHasSize(b: Pick<BlockEntry, 'acres' | 'widthFt' | 'lengthFt'>): boolean {
  if (b.widthFt && b.lengthFt && b.widthFt > 0 && b.lengthFt > 0) return true;
  return b.acres != null && b.acres > 0;
}

export type PriorSeason = {
  year: number;
  blocks: Array<{ blockId: string; blockName: string; crops: string[] }>;
};

export type CropCatalogItem = {
  pluginId: string;
  displayName: string;
  cropFamily: string;
};

export type SufficiencyResult = {
  status: 'deficit' | 'match' | 'surplus';
  plantsAvailable: number;
  plantsFit: number;
  utilizationPct: number;
  leftoverPlants: number;
};

/** Why a picked block took no more of a left-over seed (contract C-1,
 *  mirrored from `lib/layout/split.ts`). */
export type LeftoverBlockStatus =
  | 'full'
  | 'too-small'
  | 'keep-apart'
  | 'rotation'
  | 'cross-pollination'
  | 'sun'
  | 'narrow'
  | 'kept-in-one-bed';

export type LeftoverReport = {
  stockItemId: string;
  cropPluginId: string;
  plantsLeft: number;
  blocks: Array<{ blockId: string; status: LeftoverBlockStatus; withPluginId?: string }>;
};

export type AllocationResponse = {
  assignments: Array<{
    stockItemId: string;
    cropPluginId: string;
    varietyDisplayName: string;
    blockId: string;
    plants: number;
  }>;
  unplaced: Array<{ stockItemId: string; cropPluginId: string; quantityPlants: number }>;
  sufficiency: Record<string, SufficiencyResult>;
  rationale: string;
  perRowRationale: Record<string, string>;
  advisories: string[];
  pollinationConstraints?: PollinationConstraint[];
  geometryMissingBlockIds?: string[];
  companionGroups?: CompanionGroupMarker[];
  /** Phase 35: one report per counted seed with plants left over. */
  leftover?: LeftoverReport[];
  /** Phase 35: picked blocks that are garden or greenhouse beds. */
  sharedBedBlockIds?: string[];
  meta: {
    model: string;
    usdEstimate: number;
    fallback?: 'engine-only' | 'no-api-key' | 'over-cap' | 'quota-exceeded' | 'ai-unavailable';
    violationsOnFirstAttempt?: string[];
  };
};

export type Step =
  'season-setup' | 'plan-state' | 'seeds' | 'blocks' | 'review' | 'schedule' | 'inputs' | 'commit';

/** Phase 17 — chat refinement state. The transcript is the source of truth
 *  for what's rendered in the bubble list and what gets sent to the refine
 *  endpoint on each turn. Seeded with an assistant message synthesized
 *  from the initial plan's advisories so the chat opens with the same
 *  observations the old "Worth considering" block used to show. */
// Phase 25d (#89) — `kind: 'seed'` marks the deterministic intro
// synthesized from advisories. Stripped before sending to refine
// (the seed isn't a conversational turn) and never persisted to the
// server (regenerated locally on each wizard open from the fresh
// allocation). Real conversation turns omit the kind field.
export type ChatMsg = { role: 'user' | 'assistant'; content: string; kind?: 'seed' };

export type InitialChatMessage = {
  step: 'allocation' | 'schedule' | 'inputs';
  role: 'user' | 'assistant' | 'system';
  content: string;
};

export type ScheduledPlanting = {
  stockItemId: string;
  blockId: string;
  cropPluginId: string;
  varietyDisplayName: string;
  plantingDateMs: number;
  plants: number;
  successionIndex?: { i: number; n: number };
  rationale: string;
};
export type ScheduleDiagnosis = { summary: string; suggestions: string[] };
export type ScheduleResponse = {
  scheduled: ScheduledPlanting[];
  rationale: string;
  advisories: string[];
  meta: {
    model: string;
    usdEstimate: number;
    fallback?: 'deterministic' | 'no-api-key' | 'ai-unavailable';
    violations?: string[];
    diagnosis?: ScheduleDiagnosis;
  };
};

export type ProgressStage = 'allocate' | 'schedule' | 'chat-allocate' | 'chat-schedule';

export type PluginCandidate = {
  pluginId: string;
  displayName: string;
  score: number;
  source: 'local' | 'web-search' | 'mixed';
};

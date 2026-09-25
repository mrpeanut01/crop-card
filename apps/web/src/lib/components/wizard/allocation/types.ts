import type { CompanionGroupMarker, PollinationConstraint } from '$lib/plan/types';

export type SeedStockEntry = {
  stockItemId: string;
  displayName: string;
  /** Phase 15d — short label; falls back to displayName when absent. */
  shortName?: string;
  onHand: number;
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
  plantings: Array<{ varietyDisplayName: string }>;
};

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
  meta: {
    model: string;
    usdEstimate: number;
    fallback?: 'engine-only' | 'no-api-key' | 'over-cap' | 'quota-exceeded';
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

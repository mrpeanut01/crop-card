import type { HarvestDetails } from '$lib/harvest/detailsSchema';
import type { HarvestMoistureGate, HayOperations, ZadoksStage } from '$lib/plugins/schemas';

export interface RendererData {
  hayOperations?: HayOperations;
  zadoksStages?: ZadoksStage[];
  moistureGates?: HarvestMoistureGate[];
  priorPickCount: number;
}

export interface HarvestCommitInput {
  quantity?: string;
  lotNumber?: string;
  /** UC-16 (#322) — structured stored moisture %. When present, the POST
   *  body carries it as a number so the harvest-moisture kernel gate is
   *  reachable from the form (a free-text lot-tag string is not). */
  moisturePct?: number;
  /** #662: the form's readings, stored apart from the lot number. */
  details?: HarvestDetails;
}

export interface RendererProps {
  plantingId: string;
  blockId: string;
  blockName: string;
  cropPluginId: string;
  varietyDisplayName: string;
  cropFamily?: string;
  plantingDate: number | null;
  windowStartMs?: number;
  windowEndMs?: number;
  harvestIndicators: string[];
  onCommit: (input: HarvestCommitInput) => Promise<string | null>;
  error?: string | null;
  onCancel: () => void;
  rendererData?: RendererData;
  /** #743: berry plantings on the vine archetype use the pick form. */
  formVariant?: 'berry';
}

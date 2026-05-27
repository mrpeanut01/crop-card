import type { HarvestMoistureGate, HayOperations, ZadoksStage } from '$lib/plugins/schemas';

export interface RendererData {
  hayOperations?: HayOperations;
  zadoksStages?: ZadoksStage[];
  moistureGates?: HarvestMoistureGate[];
  priorPickCount: number;
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
  onCommit: (input: { quantity?: string; lotNumber?: string }) => Promise<string | null>;
  error?: string | null;
  onCancel: () => void;
  rendererData?: RendererData;
}

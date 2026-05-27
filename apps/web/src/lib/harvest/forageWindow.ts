const DAY_MS = 24 * 60 * 60 * 1000;

export interface ForageWindowInput {
  isForage: boolean;
  lastPickMs: number | undefined;
  cutIntervalDays?: { min: number; max: number };
}

export interface ForageWindow {
  windowStartMs: number;
  windowEndMs: number;
}

export function forageCutWindow(input: ForageWindowInput): ForageWindow | null {
  if (!input.isForage) return null;
  if (input.lastPickMs === undefined) return null;
  if (!input.cutIntervalDays) return null;
  return {
    windowStartMs: input.lastPickMs + input.cutIntervalDays.min * DAY_MS,
    windowEndMs: input.lastPickMs + input.cutIntervalDays.max * DAY_MS
  };
}

export interface HarvestKeyInput {
  cropId?: string | null;
  blockId: string;
  cropPluginId: string;
}

export function plantingHarvestKey(input: HarvestKeyInput): string {
  if (input.cropId) return `planting:${input.cropId}`;
  return `legacy:${input.blockId}|${input.cropPluginId}`;
}

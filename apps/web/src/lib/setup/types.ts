import type { AreaKind } from '$lib/farm/areaKinds';

export interface SprayerTemplateTile {
  templateId: string;
  label: string;
  category: string;
  description: string;
  tankGal: number | null;
  spec: Record<string, string | number>;
}

export interface SetupArea {
  id: string;
  name: string;
  kind: AreaKind;
}

export interface SetupBlock {
  id: string;
  name: string;
  areaName: string | null;
}

export interface SetupSprayerResult {
  sprayerId: string;
  label: string;
  calibratedGpa: number | null;
}

export interface SetupSpotResult {
  blockId: string;
  blockName: string;
  areaId: string;
}

export interface SetupPlantingResult {
  plantingId: string;
  blockId: string;
  cropPluginId: string;
}

export interface SetupCalibrationResult {
  sprayerId: string;
  calibratedGpa: number;
  status: 'applied' | 'pending-owner-review';
}

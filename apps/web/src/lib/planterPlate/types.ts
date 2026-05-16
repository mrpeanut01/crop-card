export type PlateSeries = 'B' | 'C';
export type PlateShape = 'Round' | 'Flat' | '';
export type PlateSeedType = 'Corn' | 'Sorghum' | 'Soybean' | 'Sunflower' | 'Sugar Beet';

export interface Plate {
  plateNumber: string;
  series: PlateSeries;
  brand: string;
  cells: number;
  color: string;
  dimensions: string;
  L: number;
  D: number;
  T: number;
  shape: PlateShape;
  seedType: PlateSeedType;
  gradeSize: string;
  notes: string;
}

export interface MatchInput {
  seedType: PlateSeedType;
  series?: PlateSeries | 'Both';
  shape?: 'Round' | 'Flat' | 'Either';
  cells?: number | 'Either';
  /** Seed dimensions in 64ths of an inch (the catalog's native unit). */
  dimensions?: { L: number; D: number; T: number };
  /** Total per-dimension tolerance budget in 64ths of an inch. */
  toleranceInternal?: number;
  /** Cap on the number of returned matches. */
  limit?: number;
}

export interface MatchResult extends Plate {
  /** Total dimension delta (Σ |seed − plate|) when input dims supplied. */
  delta?: number;
}

export interface CellRecommendation {
  cells: 16 | 24;
  band: 'low' | 'mid' | 'high';
  plantsPerAcre: number;
  note: string;
}

export const MM_TO_64THS = 64 / 25.4;

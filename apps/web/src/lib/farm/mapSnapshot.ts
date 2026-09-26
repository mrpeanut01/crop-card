import {
  FARM_SNAPSHOT_VERSION,
  type FarmSnapshot,
  type SnapshotAcresSource,
  type SnapshotArea,
  type SnapshotBlock,
  type SnapshotPlanting
} from '$lib/cards/snapshot';
import type { AreaKind, BedStyle, BlockKind } from './areaKinds';

/** The field and block shapes the map pages already load, minus server types. */
export interface MapAreaInput {
  id: string;
  name: string;
  kind?: AreaKind;
  acres?: number;
  widthFt?: number;
  lengthFt?: number;
  perimeterFt?: number;
  acresSource?: SnapshotAcresSource;
  notes?: string;
}

export interface MapBlockInput {
  id: string;
  name: string;
  fieldId?: string;
  blockLabel?: string;
  kind?: BlockKind;
  acres?: number;
  widthFt?: number;
  lengthFt?: number;
  xFt?: number;
  yFt?: number;
  rotationDeg?: number;
  bedStyle?: BedStyle;
  plantings?: Array<{
    id: string;
    cropPluginId: string;
    varietyDisplayName: string;
    plantingDate: number | null;
    quantityPlanted?: number;
    quantityUnit?: string;
  }>;
}

export function snapshotAreas(fields: readonly MapAreaInput[]): SnapshotArea[] {
  return fields.map((f) => ({
    id: f.id,
    name: f.name,
    kind: f.kind ?? 'field',
    acres: f.acres ?? null,
    widthFt: f.widthFt ?? null,
    lengthFt: f.lengthFt ?? null,
    perimeterFt: f.perimeterFt ?? null,
    acresSource: f.acresSource ?? null,
    notes: f.notes ?? null
  }));
}

export function snapshotBlocks(blocks: readonly MapBlockInput[]): SnapshotBlock[] {
  return blocks.map((b) => ({
    id: b.id,
    areaId: b.fieldId ?? null,
    name: b.name,
    blockLabel: b.blockLabel ?? null,
    kind: b.kind ?? 'block',
    acres: b.acres ?? null,
    widthFt: b.widthFt ?? null,
    lengthFt: b.lengthFt ?? null,
    layout:
      b.xFt !== undefined || b.yFt !== undefined || b.bedStyle !== undefined
        ? {
            xFt: b.xFt ?? null,
            yFt: b.yFt ?? null,
            rotationDeg: b.rotationDeg ?? null,
            bedStyle: b.bedStyle ?? null
          }
        : null
  }));
}

function ymd(ms: number | null | undefined): string | null {
  return ms == null ? null : new Date(ms).toISOString().slice(0, 10);
}

/**
 * A card snapshot built from what a map page already has in hand, for pages
 * that don't load the full one. Block plantings carry no status, so they
 * read as active; there are no tasks or frost dates.
 */
export function snapshotFromMapData(input: {
  ownerId: string;
  fields: readonly MapAreaInput[];
  blocks: readonly MapBlockInput[];
  farmName?: string | null;
  now?: number;
}): FarmSnapshot {
  const plantings: SnapshotPlanting[] = input.blocks.flatMap((b) =>
    (b.plantings ?? []).map((p) => ({
      id: p.id,
      blockId: b.id,
      cropPluginId: p.cropPluginId,
      varietyDisplayName: p.varietyDisplayName,
      status: 'active' as const,
      plantingDate: ymd(p.plantingDate),
      harvestedAt: null,
      quantityPlanted: p.quantityPlanted ?? null,
      quantityUnit: p.quantityUnit ?? null,
      spacingIn: null,
      rowSpacingIn: null,
      plantCount: null,
      plantCountProvenance: null,
      sourceProvenance: null
    }))
  );
  return {
    version: FARM_SNAPSHOT_VERSION,
    ownerId: input.ownerId,
    farmName: input.farmName ?? null,
    generatedAt: input.now ?? Date.now(),
    rulesVersion: '',
    origin: null,
    areas: snapshotAreas(input.fields),
    blocks: snapshotBlocks(input.blocks),
    plantings,
    tasks: [],
    equipment: [],
    stock: [],
    cropPlugins: {},
    frost: null
  };
}

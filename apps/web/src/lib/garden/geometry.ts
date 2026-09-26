/**
 * Pure designer geometry in Area feet. No DOM, no DB. Spec:
 * docs/design/GARDEN_DESIGNER.md ("Geometry rules").
 */

import type {
  AreaCanvas,
  BedLayout,
  BedPreset,
  BedPresetId,
  Footprint,
  PointFt,
  RectFt,
  Rotation
} from './types';

export const SNAP_FT = 0.5;
export const FOOTPRINT_SNAP_IN = 6;
export const SFG_SNAP_IN = 12;
export const MIN_BED_FT = 1;
export const DEFAULT_CANVAS_FT = { widthFt: 20, lengthFt: 30 } as const;
export const ADJACENT_GAP_FT = 4;

export const BED_PRESETS: Record<BedPresetId, BedPreset> = {
  'raised-4x8': {
    id: 'raised-4x8',
    label: '4×8 raised bed',
    kind: 'bed',
    bedStyle: 'raised',
    widthFt: 4,
    lengthFt: 8
  },
  'in-ground-3x10': {
    id: 'in-ground-3x10',
    label: '3×10 in-ground bed',
    kind: 'bed',
    bedStyle: 'in-ground',
    widthFt: 3,
    lengthFt: 10
  },
  'row-30in': {
    id: 'row-30in',
    label: '30 in row',
    kind: 'bed',
    bedStyle: 'in-ground',
    widthFt: 2.5,
    lengthFt: 20
  },
  'container-5gal': {
    id: 'container-5gal',
    label: '5 gal container',
    kind: 'container',
    bedStyle: 'container',
    widthFt: 1,
    lengthFt: 1
  },
  custom: {
    id: 'custom',
    label: 'Custom size',
    kind: 'bed',
    bedStyle: 'raised',
    widthFt: 4,
    lengthFt: 4
  }
};

export function pointFt(x: number, y: number): PointFt {
  return { x, y } as PointFt;
}

export function rectFt(x: number, y: number, w: number, l: number): RectFt {
  return { x, y, w, l } as RectFt;
}

function notImplemented(name: string): never {
  throw new Error(`lib/garden/geometry.${name}: not implemented`);
}

/** Canvas from the Area's typed Size, else its polygon's bounding box in
 *  feet, else `DEFAULT_CANVAS_FT`. */
export function canvasFromArea(_area: {
  id: string;
  name: string;
  widthFt: number | null;
  lengthFt: number | null;
  geojson: string | null;
}): AreaCanvas {
  return notImplemented('canvasFromArea');
}

/** Nearest multiple of `step`, rounded half away from zero. */
export function snap(_value: number, _step?: number): number {
  return notImplemented('snap');
}

export function snapRect(_rect: RectFt, _step?: number): RectFt {
  return notImplemented('snapRect');
}

/** Canvas box a bed of this size covers at this rotation, top-left at x, y. */
export function bedRect(
  _xFt: number,
  _yFt: number,
  _widthFt: number,
  _lengthFt: number,
  _rotationDeg: Rotation
): RectFt {
  return notImplemented('bedRect');
}

/** Shift `rect` the least distance that puts it fully inside the canvas.
 *  Null when it is larger than the canvas in either direction. */
export function clampToArea(_rect: RectFt, _canvas: AreaCanvas): RectFt | null {
  return notImplemented('clampToArea');
}

/** Moves by whole snap steps, then clamps. */
export function nudge(
  _bed: BedLayout,
  _dxFt: number,
  _dyFt: number,
  _canvas: AreaCanvas
): BedLayout {
  return notImplemented('nudge');
}

/** Next 90° step clockwise about the bed's center, snapped and clamped.
 *  Null when the rotated bed cannot fit the canvas. */
export function rotate90(_bed: BedLayout, _canvas: AreaCanvas): BedLayout | null {
  return notImplemented('rotate90');
}

/** Resize from the bottom-right handle, snapped, at least `MIN_BED_FT`,
 *  clamped to the canvas. Sizes are canvas-oriented and mapped back to the
 *  bed's own width and length for its rotation. */
export function resize(_bed: BedLayout, _rect: RectFt, _canvas: AreaCanvas): BedLayout {
  return notImplemented('resize');
}

/** Topmost bed under the point (last in array order wins), or null. */
export function hitTest(_point: PointFt, _beds: readonly BedLayout[]): string | null {
  return notImplemented('hitTest');
}

/** Interiors intersect; shared edges do not count. */
export function rectsOverlap(_a: RectFt, _b: RectFt): boolean {
  return notImplemented('rectsOverlap');
}

/** Ids of beds that overlap `rect`, excluding `ignoreBlockId`. */
export function overlappingBeds(
  _rect: RectFt,
  _beds: readonly BedLayout[],
  _ignoreBlockId?: string
): string[] {
  return notImplemented('overlappingBeds');
}

/** First free snapped spot for a new or duplicated bed of this size, scanning
 *  right of `near` and then row by row. Null when the Area is full. */
export function freeSpot(
  _widthFt: number,
  _lengthFt: number,
  _rotationDeg: Rotation,
  _beds: readonly BedLayout[],
  _canvas: AreaCanvas,
  _near?: RectFt
): RectFt | null {
  return notImplemented('freeSpot');
}

/** Bed pairs whose edges are within `gapFt` of each other, ids sorted. */
export function adjacentBeds(
  _beds: readonly BedLayout[],
  _gapFt?: number
): Array<[string, string]> {
  return notImplemented('adjacentBeds');
}

/** Snap to `FOOTPRINT_SNAP_IN` (or `SFG_SNAP_IN`), at least one step in each
 *  direction, clamped inside the bed's own unrotated inches. */
export function clampFootprint(
  _fp: Footprint,
  _bed: Pick<BedLayout, 'widthFt' | 'lengthFt'>,
  _sfg?: boolean
): Footprint {
  return notImplemented('clampFootprint');
}

export function footprintsOverlap(_a: Footprint, _b: Footprint): boolean {
  return notImplemented('footprintsOverlap');
}

/** Canvas box a footprint covers once its bed's position and rotation apply. */
export function footprintBounds(_fp: Footprint, _bed: BedLayout): RectFt {
  return notImplemented('footprintBounds');
}

/** Canvas point to the bed's own unrotated inches, for drops and taps inside
 *  a bed. Null when the point is outside the bed. */
export function pointInBedIn(
  _point: PointFt,
  _bed: BedLayout
): { xIn: number; yIn: number } | null {
  return notImplemented('pointInBedIn');
}

/** Largest free snapped footprint of about `want` inside the bed that avoids
 *  `taken`, preferring the spot closest to `at`. Null when nothing fits. */
export function fitFootprint(
  _bed: Pick<BedLayout, 'widthFt' | 'lengthFt'>,
  _want: { w_in: number; l_in: number },
  _taken: readonly Footprint[],
  _at?: { xIn: number; yIn: number }
): Footprint | null {
  return notImplemented('fitFootprint');
}

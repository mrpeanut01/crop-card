/**
 * Dimension sketch for farms mapped without GPS: fields and blocks entered as
 * width × length in feet are laid out as boxes on a plain background. The
 * layout is illustrative only (positions are packed, not surveyed), so it
 * never feeds geometry consumers like pollination distance or the shade model.
 */

import { DEFAULT_PREFS, formatQuantity, type Prefs } from '$lib/prefs';

export const SQFT_PER_ACRE = 43_560;
export const MAX_SKETCH_FT = 20_000;

export function sketchAcres(
  widthFt: number | null | undefined,
  lengthFt: number | null | undefined
): number | undefined {
  if (widthFt == null || lengthFt == null) return undefined;
  if (!(widthFt > 0) || !(lengthFt > 0)) return undefined;
  return Number(((widthFt * lengthFt) / SQFT_PER_ACRE).toFixed(3));
}

export interface SketchInput {
  id: string;
  name: string;
  widthFt?: number;
  lengthFt?: number;
  acres?: number;
}

export interface SketchBlockInput extends SketchInput {
  fieldId?: string;
}

export interface SketchRect {
  id: string;
  name: string;
  x: number;
  y: number;
  w: number;
  h: number;
  /** True when the size came from entered dimensions, false when from acres. */
  measured: boolean;
}

export interface SketchBlockRect extends SketchRect {
  /** False when the block runs past its field's edge. */
  fits: boolean;
}

export interface SketchFieldRect extends SketchRect {
  blocks: SketchBlockRect[];
}

export interface SketchLayout {
  width: number;
  height: number;
  fields: SketchFieldRect[];
  /** Fields and blocks with neither dimensions nor acres; they can't be drawn. */
  unsized: string[];
}

function sizeOf(item: SketchInput): { w: number; h: number; measured: boolean } | null {
  if (item.widthFt && item.widthFt > 0 && item.lengthFt && item.lengthFt > 0) {
    return { w: item.widthFt, h: item.lengthFt, measured: true };
  }
  if (item.acres && item.acres > 0) {
    const side = Math.sqrt(item.acres * SQFT_PER_ACRE);
    return { w: side, h: side, measured: false };
  }
  return null;
}

interface Placed<T> {
  item: T;
  x: number;
  y: number;
}

/** Shelf packing: left to right, wrapping to a new row past `rowWidth`. */
function shelfPack<T extends { w: number; h: number }>(
  items: T[],
  rowWidth: number,
  gap: number
): { placed: Placed<T>[]; width: number; height: number } {
  const placed: Placed<T>[] = [];
  let x = 0;
  let y = 0;
  let rowH = 0;
  let width = 0;
  for (const item of items) {
    if (x > 0 && x + item.w > rowWidth) {
      y += rowH + gap;
      x = 0;
      rowH = 0;
    }
    placed.push({ item, x, y });
    x += item.w + gap;
    rowH = Math.max(rowH, item.h);
    width = Math.max(width, x - gap);
  }
  return { placed, width, height: placed.length ? y + rowH : 0 };
}

export function layoutSketch(fields: SketchInput[], blocks: SketchBlockInput[]): SketchLayout {
  const unsized: string[] = [];

  const sizedBlocksByField = new Map<
    string,
    Array<SketchBlockInput & { w: number; h: number; measured: boolean }>
  >();
  for (const b of blocks) {
    const s = sizeOf(b);
    if (!s) {
      unsized.push(b.name);
      continue;
    }
    const key = b.fieldId ?? '';
    const list = sizedBlocksByField.get(key) ?? [];
    list.push({ ...b, ...s });
    sizedBlocksByField.set(key, list);
  }

  const fieldBoxes: Array<{
    field: SketchInput;
    w: number;
    h: number;
    measured: boolean;
    blocks: SketchBlockRect[];
  }> = [];

  for (const f of fields) {
    const own = sizedBlocksByField.get(f.id) ?? [];
    const s = sizeOf(f);
    if (!s && own.length === 0) {
      unsized.push(f.name);
      continue;
    }
    const innerGap = s ? Math.max(2, Math.min(s.w, s.h) * 0.02) : 6;
    const rowWidth = s ? s.w : Math.max(...own.map((b) => b.w)) * 2 + innerGap;
    const packed = shelfPack(own, rowWidth, innerGap);
    const w = s ? s.w : packed.width;
    const h = s ? s.h : packed.height;
    fieldBoxes.push({
      field: f,
      w,
      h,
      measured: s?.measured ?? false,
      blocks: packed.placed.map(({ item, x, y }) => ({
        id: item.id,
        name: item.name,
        x,
        y,
        w: item.w,
        h: item.h,
        measured: item.measured,
        fits: x + item.w <= w + 1e-6 && y + item.h <= h + 1e-6
      }))
    });
  }

  if (fieldBoxes.length === 0) return { width: 0, height: 0, fields: [], unsized };

  const totalArea = fieldBoxes.reduce((sum, f) => sum + f.w * f.h, 0);
  const widest = Math.max(...fieldBoxes.map((f) => f.w));
  const largestSide = Math.max(...fieldBoxes.map((f) => Math.max(f.w, f.h)));
  const gap = Math.max(10, largestSide * 0.06);
  const rowWidth = Math.max(widest, Math.sqrt(totalArea) * 1.6);
  const packed = shelfPack(fieldBoxes, rowWidth, gap);

  return {
    width: packed.width,
    height: packed.height,
    unsized,
    fields: packed.placed.map(({ item, x, y }) => ({
      id: item.field.id,
      name: item.field.name,
      x,
      y,
      w: item.w,
      h: item.h,
      measured: item.measured,
      blocks: item.blocks.map((b) => ({ ...b, x: b.x + x, y: b.y + y }))
    }))
  };
}

export function formatFt(n: number, prefs: Pick<Prefs, 'units'> = DEFAULT_PREFS): string {
  return formatQuantity(n, 'distance', prefs, { digits: 0 });
}

/** Fills `acres` from width × length when a patch sets both and leaves acres out. */
export function withSketchAcres<
  T extends { acres?: number | null; widthFt?: number | null; lengthFt?: number | null }
>(patch: T): T {
  if (patch.acres !== undefined) return patch;
  const acres = sketchAcres(patch.widthFt, patch.lengthFt);
  return acres === undefined ? patch : { ...patch, acres };
}

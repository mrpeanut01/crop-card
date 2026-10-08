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
  return Number(((widthFt * lengthFt) / SQFT_PER_ACRE).toPrecision(6));
}

/** Sketch acres used to be rounded to 3 decimals, so a 4 x 8 ft bed was
 *  stored as 0.001 ac (about 44 sq ft). A stored value that matches that
 *  old rounding of its own width and length reads as the exact figure. */
export function storedSketchAcres(
  stored: number | null | undefined,
  widthFt: number | null | undefined,
  lengthFt: number | null | undefined
): number | null | undefined {
  if (stored == null) return stored;
  const exact = sketchAcres(widthFt, lengthFt);
  if (exact === undefined) return stored;
  const legacy = Number(((widthFt! * lengthFt!) / SQFT_PER_ACRE).toFixed(3));
  return Math.abs(stored - legacy) < 1e-9 ? exact : stored;
}

/** Acres measured from a drawn shape, rounded for `POST /api/fields` and
 *  `POST /api/blocks`. A shape under about 0.005 acres (a coop, a raised
 *  bed) rounds to 0, which the API rejects, so it is left out and the
 *  server measures the drawn shape itself. */
export function acresForApi(acres: number | null | undefined): number | undefined {
  if (acres == null || !Number.isFinite(acres)) return undefined;
  const rounded = Number(acres.toFixed(2));
  return rounded > 0 ? rounded : undefined;
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
  /** Names of Areas with a block drawn past their edge. */
  overflowing: string[];
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

export interface SketchLabelSpace {
  /** Width an Area's label needs, in feet at the drawing's scale. */
  widthFt: (field: SketchInput) => number;
  /** Height kept above each Area for its label, in feet. */
  heightFt: number;
}

/**
 * Lays the Areas out as boxes. Each Area takes the room of its box, any
 * blocks drawn past its edge and, when `labels` is given, its label above
 * it, so a neighbour's box or name never lands on top of either.
 */
export function layoutSketch(
  fields: SketchInput[],
  blocks: SketchBlockInput[],
  labels?: SketchLabelSpace
): SketchLayout {
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

  const labelH = labels ? Math.max(0, labels.heightFt) : 0;
  const fieldBoxes: Array<{
    field: SketchInput;
    w: number;
    h: number;
    measured: boolean;
    blocks: SketchBlockRect[];
    /** The room the Area takes when packed: box, overflow and label. */
    footW: number;
    footH: number;
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
    const labelW = labels ? Math.max(0, labels.widthFt(f)) : 0;
    fieldBoxes.push({
      field: f,
      w,
      h,
      measured: s?.measured ?? false,
      footW: Math.max(w, packed.width, labelW),
      footH: labelH + Math.max(h, packed.height),
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

  if (fieldBoxes.length === 0) return { width: 0, height: 0, fields: [], unsized, overflowing: [] };

  const footprints = fieldBoxes.map((box) => ({ box, w: box.footW, h: box.footH }));
  const totalArea = footprints.reduce((sum, f) => sum + f.w * f.h, 0);
  const widest = Math.max(...footprints.map((f) => f.w));
  const largestSide = Math.max(...footprints.map((f) => Math.max(f.w, f.h)));
  const gap = Math.max(10, largestSide * 0.06);
  const rowWidth = Math.max(widest, Math.sqrt(totalArea) * 1.6);
  const packed = shelfPack(footprints, rowWidth, gap);

  return {
    width: packed.width,
    height: packed.height,
    unsized,
    overflowing: fieldBoxes.filter((f) => f.blocks.some((b) => !b.fits)).map((f) => f.field.name),
    fields: packed.placed.map(({ item: { box }, x, y }) => ({
      id: box.field.id,
      name: box.field.name,
      x,
      y: y + labelH,
      w: box.w,
      h: box.h,
      measured: box.measured,
      blocks: box.blocks.map((b) => ({ ...b, x: b.x + x, y: b.y + y + labelH }))
    }))
  };
}

export function formatFt(
  n: number,
  prefs: Pick<Prefs, 'units' | 'locale'> = DEFAULT_PREFS
): string {
  return formatQuantity(n, 'distance', prefs, { digits: 0, locale: prefs.locale });
}

/** Fills `acres` from width × length when a patch sets both and leaves acres out. */
export function withSketchAcres<
  T extends { acres?: number | null; widthFt?: number | null; lengthFt?: number | null }
>(patch: T): T {
  if (patch.acres !== undefined) return patch;
  const acres = sketchAcres(patch.widthFt, patch.lengthFt);
  return acres === undefined ? patch : { ...patch, acres };
}

/** True when typed width × length and the drawn size disagree by more
 *  than a tenth, so the sketch size is shown as different from the drawing. */
export function sketchDimsDiffer(
  acres: number | null | undefined,
  widthFt: number | null | undefined,
  lengthFt: number | null | undefined
): boolean {
  const typed = sketchAcres(widthFt, lengthFt);
  if (typed === undefined || acres == null || !(acres > 0)) return false;
  return Math.abs(typed - acres) / Math.max(typed, acres) > 0.1;
}

export interface AreaBlockCheck {
  /** Set when the blocks add up to more than the Area. */
  over: { blocksAcres: number; areaAcres: number } | null;
  /** Block names used more than once in the Area, as first typed. */
  duplicates: string[];
}

/** Advisory checks for one Area's blocks; nothing here refuses a save. */
export function checkAreaBlocks(
  areaAcres: number | null | undefined,
  blocks: ReadonlyArray<{ name: string; acres?: number | null }>
): AreaBlockCheck {
  const blocksAcres = blocks.reduce((sum, b) => sum + (b.acres && b.acres > 0 ? b.acres : 0), 0);
  const over =
    areaAcres != null && areaAcres > 0 && blocksAcres > areaAcres * 1.01 + 1e-9
      ? { blocksAcres, areaAcres }
      : null;
  const seen = new Map<string, { name: string; count: number }>();
  for (const b of blocks) {
    const key = b.name.trim().toLocaleLowerCase();
    if (!key) continue;
    const hit = seen.get(key);
    if (hit) hit.count += 1;
    else seen.set(key, { name: b.name.trim(), count: 1 });
  }
  const duplicates = [...seen.values()].filter((v) => v.count > 1).map((v) => v.name);
  return { over, duplicates };
}

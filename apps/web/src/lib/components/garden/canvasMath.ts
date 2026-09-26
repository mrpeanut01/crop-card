import { plantCount } from '$lib/garden/plantCount';
import type { BedLayout, Footprint, PlantSpacing, RectFt } from '$lib/garden/types';

export const MAX_DOTS = 240;
export const MAX_PX_PER_FT = 96;
export const RULER_MARGIN_FT = 1.5;

export interface View {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** A bed's own feet (u across its width, v along its length) on the canvas. */
export function bedLocalToCanvas(bed: BedLayout, u: number, v: number): [number, number] {
  const W = bed.widthFt;
  const L = bed.lengthFt;
  switch (bed.rotationDeg) {
    case 90:
      return [bed.rect.x + (L - v), bed.rect.y + u];
    case 180:
      return [bed.rect.x + (W - u), bed.rect.y + (L - v)];
    case 270:
      return [bed.rect.x + v, bed.rect.y + (W - u)];
    default:
      return [bed.rect.x + u, bed.rect.y + v];
  }
}

/** Plant positions for a footprint, rows running along the bed's length.
 *  Capped at `MAX_DOTS`; a large planting shows its pattern, not every plant. */
export function plantDots(
  fp: Footprint,
  bed: BedLayout,
  spacing: PlantSpacing
): Array<[number, number]> {
  const { rows, perRow } = plantCount(fp, spacing);
  const out: Array<[number, number]> = [];
  const w = fp.w_in / 12;
  const l = fp.l_in / 12;
  const x0 = fp.x_in / 12;
  const y0 = fp.y_in / 12;
  const stride = Math.max(1, Math.ceil((rows * perRow) / MAX_DOTS));
  let k = 0;
  for (let i = 0; i < rows; i++) {
    const offset = spacing.pattern === 'offset' && i % 2 === 1 ? 0.5 : 0;
    const n = offset ? Math.max(1, perRow - 1) : perRow;
    for (let j = 0; j < n; j++) {
      if (k++ % stride !== 0) continue;
      const u = x0 + ((i + 0.5) * w) / rows;
      const v = y0 + ((j + 0.5 + offset) * l) / perRow;
      out.push(bedLocalToCanvas(bed, u, v));
    }
  }
  return out;
}

export function fitView(widthFt: number, lengthFt: number): View {
  return {
    x: -RULER_MARGIN_FT,
    y: -RULER_MARGIN_FT,
    w: widthFt + 2 * RULER_MARGIN_FT,
    h: lengthFt + 2 * RULER_MARGIN_FT
  };
}

/** Zoom about a point, kept between "whole Area fits" and `MAX_PX_PER_FT`. */
export function zoomView(
  view: View,
  factor: number,
  cx: number,
  cy: number,
  fit: View,
  viewportPx: number
): View {
  const minW = Math.max(1, viewportPx / MAX_PX_PER_FT);
  const w = Math.min(fit.w, Math.max(minW, view.w / factor));
  const scale = w / view.w;
  const h = view.h * scale;
  return clampView({ x: cx - (cx - view.x) * scale, y: cy - (cy - view.y) * scale, w, h }, fit);
}

export function clampView(view: View, fit: View): View {
  const x = Math.min(fit.x + fit.w - view.w, Math.max(fit.x, view.x));
  const y = Math.min(fit.y + fit.h - view.h, Math.max(fit.y, view.y));
  return {
    x: view.w >= fit.w ? fit.x : x,
    y: view.h >= fit.h ? fit.y : y,
    w: view.w,
    h: view.h
  };
}

const CHAR_EM = 0.54;

/** Rough width of a label in feet at a font size in feet. */
export function textWidthFt(text: string, fontFt: number): number {
  return text.length * CHAR_EM * fontFt;
}

/** The label cut to fit `widthFt`, with an ellipsis; empty when not even
 *  two characters fit. */
export function fitText(text: string, widthFt: number, fontFt: number): string {
  const max = Math.floor(widthFt / (CHAR_EM * fontFt) + 1e-6);
  if (text.length <= max) return text;
  if (max < 3) return '';
  return `${text.slice(0, max - 1).trimEnd()}…`;
}

/** Pads a small shape's hit area to at least `minFt` each way. */
export function padRect(
  r: Pick<RectFt, 'x' | 'y' | 'w' | 'l'>,
  minFt: number
): { x: number; y: number; w: number; h: number } {
  const w = Math.max(r.w, minFt);
  const h = Math.max(r.l, minFt);
  return { x: r.x - (w - r.w) / 2, y: r.y - (h - r.l) / 2, w, h };
}

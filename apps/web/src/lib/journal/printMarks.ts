/** The numbered lines and the shapes of a marked photo's print sheet (#869,
 *  FU869-2). Pure and client-safe. */

import type { PhotoMark, PhotoMarkKind } from './model';

export interface PrintMarkLine {
  n: number;
  kind: PhotoMarkKind;
  /** The mark's label, or the kind word when the label is blank, so a line
   *  never prints empty. */
  label: string;
}

/** One line per mark, numbered from 1 in the order the marks are drawn. */
export function printMarkLines(
  marks: readonly PhotoMark[],
  kindWord: (kind: PhotoMarkKind) => string
): PrintMarkLine[] {
  return marks.map((m, i) => {
    const label = (m.label ?? '').replace(/\s+/g, ' ').trim();
    return { n: i + 1, kind: m.kind, label: label || kindWord(m.kind).trim() || String(i + 1) };
  });
}

export type MarkShape = 'circle' | 'diamond';

/** Problem marks are diamonds; every other kind is a circle, so the kind
 *  reads without colour. */
export function markShape(kind: PhotoMarkKind): MarkShape {
  return kind === 'problem' ? 'diamond' : 'circle';
}

export interface MarkGeometry {
  n: number;
  kind: PhotoMarkKind;
  shape: MarkShape;
  /** Centre of the number badge, in the photo's pixels. */
  cx: number;
  cy: number;
  /** Badge radius (half the diamond's diagonal). */
  r: number;
  /** The marked area, when the mark is a box. */
  box: { x: number; y: number; w: number; h: number } | null;
}

/** Where each mark and its number go on a photo of `width` by `height`
 *  pixels. The badge grows with the photo so it prints readably. */
export function markGeometry(
  marks: readonly PhotoMark[],
  width: number,
  height: number
): MarkGeometry[] {
  const r = Math.max(8, Math.min(width, height) * 0.045);
  return marks.map((m, i) => {
    const w = (m.w ?? 0) * width;
    const h = (m.h ?? 0) * height;
    const x = m.x * width;
    const y = m.y * height;
    const box = m.w !== undefined || m.h !== undefined ? { x, y, w, h } : null;
    return {
      n: i + 1,
      kind: m.kind,
      shape: markShape(m.kind),
      cx: Math.min(Math.max(x + w / 2, r), width - r),
      cy: Math.min(Math.max(y + h / 2, r), height - r),
      r,
      box
    };
  });
}

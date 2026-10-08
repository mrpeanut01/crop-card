export interface AreaLabelBox {
  id: string;
  /** The Area's on-screen size, in pixels. */
  shapeW: number;
  shapeH: number;
  /** The name label's on-screen box. */
  x: number;
  y: number;
  w: number;
  h: number;
}

const FIT_SLACK_W = 16;
const FIT_SLACK_H = 8;
const PAD = 2;

/** Which Area names to show on the map: biggest Areas first, a name shows
 *  only when it roughly fits inside its Area at this zoom and does not
 *  overlap a name already shown. Hidden names come back on zooming in. */
export function visibleAreaLabels(boxes: readonly AreaLabelBox[]): Set<string> {
  const show = new Set<string>();
  const placed: AreaLabelBox[] = [];
  const sorted = [...boxes].sort((a, b) => b.shapeW * b.shapeH - a.shapeW * a.shapeH);
  for (const b of sorted) {
    if (b.w <= 0 || b.h <= 0) {
      show.add(b.id);
      continue;
    }
    if (b.w > b.shapeW + FIT_SLACK_W || b.h > b.shapeH + FIT_SLACK_H) continue;
    const hit = placed.some(
      (q) =>
        b.x < q.x + q.w + PAD &&
        q.x < b.x + b.w + PAD &&
        b.y < q.y + q.h + PAD &&
        q.y < b.y + b.h + PAD
    );
    if (hit) continue;
    placed.push(b);
    show.add(b.id);
  }
  return show;
}

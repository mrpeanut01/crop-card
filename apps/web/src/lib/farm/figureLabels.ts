/**
 * Area names on the farm map figure (#572). When Areas sit close together at
 * the map's scale their names overprint each other; an Area whose name would
 * collide with one already placed shows a number instead, and the legend
 * under the map says what each number is (as the printed bed map does).
 */

export interface FigureLabelInput {
  id: string;
  name: string;
  labelX: number;
  labelY: number;
  rings: Array<[number, number]>[];
}

export interface FigureLabel {
  id: string;
  x: number;
  y: number;
  /** The name to draw, or null when the Area shows a number. */
  text: string | null;
  n: number | null;
}

export interface FigureLegendRow {
  n: number;
  name: string;
}

const CHAR_WIDTH = 0.6;
const LINE = 1.25;

type Box = { x0: number; y0: number; x1: number; y1: number };

function box(x: number, y: number, w: number, h: number): Box {
  return { x0: x - w / 2, y0: y - h / 2, x1: x + w / 2, y1: y + h / 2 };
}

function overlaps(a: Box, b: Box): boolean {
  return a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;
}

function extent(rings: Array<[number, number]>[]): number {
  const pts = rings.flat();
  if (!pts.length) return 0;
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  return (Math.max(...xs) - Math.min(...xs)) * (Math.max(...ys) - Math.min(...ys));
}

/** Larger Areas keep their names first; numbers follow the input order. */
export function placeFigureLabels(
  fields: readonly FigureLabelInput[],
  font: number
): { labels: FigureLabel[]; legend: FigureLegendRow[] } {
  const order = fields
    .map((f, i) => ({ f, i, size: extent(f.rings) }))
    .sort((a, b) => b.size - a.size || a.i - b.i);
  const placed: Box[] = [];
  const named = new Set<string>();
  for (const { f } of order) {
    const b = box(f.labelX, f.labelY, f.name.length * font * CHAR_WIDTH, font * LINE);
    if (placed.some((p) => overlaps(p, b))) continue;
    placed.push(b);
    named.add(f.id);
  }
  const legend: FigureLegendRow[] = [];
  const labels = fields.map((f): FigureLabel => {
    if (named.has(f.id)) return { id: f.id, x: f.labelX, y: f.labelY, text: f.name, n: null };
    const n = legend.length + 1;
    legend.push({ n, name: f.name });
    return { id: f.id, x: f.labelX, y: f.labelY, text: null, n };
  });
  return { labels, legend };
}

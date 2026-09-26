/**
 * Server check for a bed's position in its garden (Phase 30E): a placed bed
 * or container must sit fully inside the Area's canvas and must not overlap
 * another placed bed there. Reads go through the tenant-scoped repos.
 */

import { listBlocks, type Block } from '$lib/db/blocks';
import { listCrops, setPlacement, type Crop } from '$lib/db/crops';
import { getField } from '$lib/db/fields';
import { isDesignable, normalizeRotationDeg, usesDesignerLayout } from '$lib/farm/areaKinds';
import { bedRect, canvasFromArea, clampFootprint, rectsOverlap } from '$lib/garden/geometry';
import type { Rotation } from '$lib/garden/types';

const EPS = 1e-6;

export interface BedLayoutProblem {
  error: string;
  code: 'OUTSIDE_AREA' | 'OVERLAP';
}

const EDGE_IN = 1e-6;

type Size = { widthFt: number | undefined; lengthFt: number | undefined };

function isFinished(c: Crop): boolean {
  return c.status === 'harvested' || c.status === 'failed' || c.status === 'archived';
}

function outside(c: Crop, size: { widthFt: number; lengthFt: number }): boolean {
  const fp = c.footprint;
  if (!fp) return false;
  return (
    fp.x_in + fp.w_in > size.widthFt * 12 + EDGE_IN ||
    fp.y_in + fp.l_in > size.lengthFt * 12 + EDGE_IN
  );
}

/** Refuses a new bed Size that would leave a current planting (planned or
 *  growing) past the bed's edge, naming the plantings in the way. */
export function plantingsPastBedEdge(
  blockId: string,
  bedName: string,
  size: Size
): BedLayoutProblem | null {
  if (!size.widthFt || !size.lengthFt) return null;
  const sized = { widthFt: size.widthFt, lengthFt: size.lengthFt };
  const inTheWay = listCrops({ blockId }).filter((c) => !isFinished(c) && outside(c, sized));
  if (inTheWay.length === 0) return null;
  const names = [...new Set(inTheWay.map((c) => c.varietyDisplayName))].join(', ');
  return {
    error: `${bedName} can't get that small. ${names} would sit past the new edge. Move or shrink ${inTheWay.length === 1 ? 'it' : 'them'} first.`,
    code: 'OUTSIDE_AREA'
  };
}

/** Pulls finished plantings' footprints inside a bed's new Size, so history
 *  never draws outside the bed. Counts stay as recorded. */
export function clampFinishedFootprints(blockId: string, size: Size): void {
  if (!size.widthFt || !size.lengthFt) return;
  const sized = { widthFt: size.widthFt, lengthFt: size.lengthFt };
  for (const c of listCrops({ blockId })) {
    if (!isFinished(c) || !c.footprint || !outside(c, sized)) continue;
    setPlacement(c.id, {
      footprint: clampFootprint(c.footprint, sized, c.spacingPattern === 'sfg'),
      spacingIn: c.spacingIn ?? null,
      rowSpacingIn: c.rowSpacingIn ?? null,
      spacingPattern: c.spacingPattern ?? 'square',
      plantCount: c.plantCount ?? null,
      plantCountProvenance: c.plantCountProvenance ?? null
    });
  }
}

type Placed = Pick<
  Block,
  'id' | 'name' | 'kind' | 'fieldId' | 'widthFt' | 'lengthFt' | 'xFt' | 'yFt' | 'rotationDeg'
>;

function rectOf(b: Placed) {
  if (b.xFt == null || b.yFt == null) return null;
  const w = b.widthFt ?? (b.kind === 'container' ? 1 : 4);
  const l = b.lengthFt ?? (b.kind === 'container' ? 1 : 8);
  return bedRect(b.xFt, b.yFt, w, l, normalizeRotationDeg(b.rotationDeg ?? 0) as Rotation);
}

/** Refuses a garden or greenhouse Size (or outline) that would leave a
 *  placed bed past its edge, naming the beds that no longer fit. */
export function bedsPastAreaEdge(next: {
  id: string;
  name: string;
  kind: Parameters<typeof isDesignable>[0];
  widthFt: number | null;
  lengthFt: number | null;
  geometryGeojson: string | null;
}): BedLayoutProblem | null {
  if (!isDesignable(next.kind)) return null;
  const canvas = canvasFromArea({
    id: next.id,
    name: next.name,
    widthFt: next.widthFt,
    lengthFt: next.lengthFt,
    geojson: next.geometryGeojson
  });
  const outsideBeds = listBlocks()
    .filter((b) => b.fieldId === next.id && b.kind && usesDesignerLayout(b.kind))
    .filter((b) => {
      const r = rectOf(b);
      return r !== null && (r.x + r.w > canvas.widthFt + EPS || r.y + r.l > canvas.lengthFt + EPS);
    });
  if (outsideBeds.length === 0) return null;
  const names = outsideBeds.map((b) => b.name).join(', ');
  return {
    error: `${next.name} can't get that small. ${names} would sit past the new edge. Move ${outsideBeds.length === 1 ? 'it' : 'them'} first.`,
    code: 'OUTSIDE_AREA'
  };
}

/** Null when the block (as it would be saved) is fine where it is. Blocks
 *  that aren't placed beds in a garden or greenhouse are never checked. */
export function bedLayoutProblem(next: Placed): BedLayoutProblem | null {
  if (!next.kind || !usesDesignerLayout(next.kind) || !next.fieldId) return null;
  const rect = rectOf(next);
  if (!rect) return null;
  const area = getField(next.fieldId);
  if (!area || !isDesignable(area.kind)) return null;
  const canvas = canvasFromArea({
    id: area.id,
    name: area.name,
    widthFt: area.widthFt ?? null,
    lengthFt: area.lengthFt ?? null,
    geojson: area.geometryGeojson ?? null
  });
  if (
    rect.x < -EPS ||
    rect.y < -EPS ||
    rect.x + rect.w > canvas.widthFt + EPS ||
    rect.y + rect.l > canvas.lengthFt + EPS
  ) {
    return { error: `${next.name} would run past the edge of ${area.name}.`, code: 'OUTSIDE_AREA' };
  }
  for (const other of listBlocks()) {
    if (other.id === next.id || other.fieldId !== next.fieldId) continue;
    if (!other.kind || !usesDesignerLayout(other.kind)) continue;
    const r = rectOf(other);
    if (r && rectsOverlap(rect, r)) {
      return { error: `Beds can't overlap: ${next.name} and ${other.name}.`, code: 'OVERLAP' };
    }
  }
  return null;
}

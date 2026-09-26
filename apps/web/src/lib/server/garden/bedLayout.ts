/**
 * Server check for a bed's position in its garden (Phase 30E): a placed bed
 * or container must sit fully inside the Area's canvas and must not overlap
 * another placed bed there. Reads go through the tenant-scoped repos.
 */

import { listBlocks, type Block } from '$lib/db/blocks';
import { getField } from '$lib/db/fields';
import { isDesignable, normalizeRotationDeg, usesDesignerLayout } from '$lib/farm/areaKinds';
import { bedRect, canvasFromArea, rectsOverlap } from '$lib/garden/geometry';
import type { Rotation } from '$lib/garden/types';

const EPS = 1e-6;

export interface BedLayoutProblem {
  error: string;
  code: 'OUTSIDE_AREA' | 'OVERLAP';
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

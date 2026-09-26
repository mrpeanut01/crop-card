import { z } from 'zod';
import {
  AREA_KIND_LABELS,
  BED_STYLES,
  BLOCK_KINDS,
  blockKindsFor,
  normalizeRotationDeg,
  usesDesignerLayout,
  type AreaKind,
  type BlockKind
} from './areaKinds';
import { MAX_SKETCH_FT } from './sketch';

const positionFt = z.number().min(0).max(MAX_SKETCH_FT);

const rotationDeg = z
  .number()
  .refine((d) => Number.isFinite(d) && d % 90 === 0, 'rotation must be a multiple of 90°')
  .transform(normalizeRotationDeg);

/** Kind + designer layout fields accepted when creating a block. */
export const blockLayoutSchema = z.object({
  kind: z.enum(BLOCK_KINDS).optional(),
  xFt: positionFt.optional(),
  yFt: positionFt.optional(),
  rotationDeg: rotationDeg.optional(),
  bedStyle: z.enum(BED_STYLES).optional()
});

/** Same fields for PATCH, where null clears a value. */
export const blockLayoutPatchSchema = z.object({
  kind: z.enum(BLOCK_KINDS).optional(),
  xFt: positionFt.nullable().optional(),
  yFt: positionFt.nullable().optional(),
  rotationDeg: rotationDeg.nullable().optional(),
  bedStyle: z.enum(BED_STYLES).nullable().optional()
});

export const BLOCK_LAYOUT_KEYS = ['xFt', 'yFt', 'rotationDeg', 'bedStyle'] as const;

type LayoutValues = Partial<Record<(typeof BLOCK_LAYOUT_KEYS)[number], unknown>>;

/** True when any designer layout field carries a value (null clears, so it
 *  doesn't count). */
export function hasLayoutValues(input: LayoutValues): boolean {
  return BLOCK_LAYOUT_KEYS.some((k) => input[k] !== undefined && input[k] !== null);
}

/**
 * Why a block of `kind` can't sit in an Area of `areaKind` with these layout
 * values, or null when it can. A block with no parent Area only gets the
 * layout check.
 */
export function blockPlacementError(
  areaKind: AreaKind | null,
  kind: BlockKind,
  layout: LayoutValues
): string | null {
  if (areaKind !== null) {
    const allowed = blockKindsFor(areaKind);
    if (!allowed.includes(kind)) {
      const label = AREA_KIND_LABELS[areaKind];
      return allowed.length
        ? `${label} Areas hold ${allowed.join(', ')}, not ${kind}`
        : `${label} Areas don't hold blocks`;
    }
  }
  if (!usesDesignerLayout(kind) && hasLayoutValues(layout)) {
    return `layout fields (xFt, yFt, rotationDeg, bedStyle) apply only to beds and containers`;
  }
  return null;
}

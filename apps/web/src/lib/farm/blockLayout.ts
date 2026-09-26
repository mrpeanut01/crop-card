import { z } from 'zod';
import { BED_STYLES, BLOCK_KINDS, normalizeRotationDeg } from './areaKinds';
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

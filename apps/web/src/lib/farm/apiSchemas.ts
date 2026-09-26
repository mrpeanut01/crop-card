import { z } from 'zod';
import { AREA_KINDS } from './areaKinds';
import { blockLayoutPatchSchema, blockLayoutSchema } from './blockLayout';
import { MAX_SKETCH_FT } from './sketch';

const polygonType = z.enum(['Polygon', 'MultiPolygon']);

/** A GeoJSON Polygon or MultiPolygon, bare or wrapped in a Feature or
 *  FeatureCollection. */
export const areaGeometrySchema = z.union([
  z.object({ type: polygonType, coordinates: z.unknown() }),
  z.object({
    type: z.literal('Feature'),
    geometry: z.object({ type: polygonType, coordinates: z.unknown() }),
    properties: z.unknown().optional()
  }),
  z.object({ type: z.literal('FeatureCollection'), features: z.array(z.unknown()) })
]);

const sketchFt = z.number().positive().max(MAX_SKETCH_FT);

/** `POST /api/fields`. `details` is checked against the kind's schema in
 *  `areaKinds.ts` after this parse. */
export const fieldCreateSchema = z.object({
  name: z.string().min(1).max(120),
  acres: z.number().positive().optional(),
  location: z.string().max(500).optional(),
  notes: z.string().max(2000).optional(),
  widthFt: sketchFt.optional(),
  lengthFt: sketchFt.optional(),
  geometryGeojson: areaGeometrySchema.optional(),
  kind: z.enum(AREA_KINDS).optional(),
  details: z.unknown().optional()
});

/** `PATCH /api/fields/:id`. Null clears a value. */
export const fieldPatchSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  acres: z.number().positive().nullable().optional(),
  location: z.string().max(500).nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
  geometryGeojson: z.string().nullable().optional(),
  widthFt: sketchFt.nullable().optional(),
  lengthFt: sketchFt.nullable().optional(),
  kind: z.enum(AREA_KINDS).optional(),
  details: z.unknown().optional()
});

/** `POST /api/blocks`. */
export const blockCreateSchema = blockLayoutSchema.extend({
  name: z.string().min(1).max(120),
  acres: z.number().positive().optional(),
  blockLabel: z.string().max(60).optional(),
  fieldId: z.string().min(1).optional(),
  widthFt: sketchFt.optional(),
  lengthFt: sketchFt.optional(),
  geometryGeojson: areaGeometrySchema.optional()
});

/** `PATCH /api/blocks/:id`. Null clears a value. */
export const blockPatchSchema = blockLayoutPatchSchema.extend({
  name: z.string().min(1).max(120).optional(),
  acres: z.number().positive().nullable().optional(),
  blockLabel: z.string().max(60).nullable().optional(),
  fieldId: z.string().min(1).optional(),
  tillageMethod: z.enum(['conventional', 'reduced-till', 'no-till']).optional(),
  slopePercent: z.number().min(0).max(100).nullable().optional(),
  slopeAspectDeg: z.number().min(0).max(360).nullable().optional(),
  widthFt: sketchFt.nullable().optional(),
  lengthFt: sketchFt.nullable().optional()
});

import { z } from 'zod';
import { DRAINAGE_CLASSES, SOIL_SOURCE_NAME } from './types';

/** Zod contracts for `/api/soil/**`. Client-safe; the OpenAPI document is
 *  generated from these. */

const coordinate = (limit: number) =>
  z
    .string()
    .trim()
    .regex(/^-?\d{1,3}(\.\d{1,12})?$/)
    .transform(Number)
    .refine((n) => Number.isFinite(n) && Math.abs(n) <= limit);

/** Query of `GET /api/soil/survey`: decimal degrees, WGS84. */
export const soilSurveyQuerySchema = z.object({
  lat: coordinate(90),
  lon: coordinate(180)
});

const nullableNumber = z.number().nullable();
const drainage = z.enum(DRAINAGE_CLASSES).nullable();

export const soilComponentSchema = z.object({
  name: z.string(),
  percent: nullableNumber,
  drainageClass: drainage,
  slopePct: nullableNumber,
  hydric: z.boolean().nullable(),
  surfaceTexture: z.string().nullable(),
  sandPct: nullableNumber,
  siltPct: nullableNumber,
  clayPct: nullableNumber,
  organicMatterPct: nullableNumber,
  ph: z.object({ low: nullableNumber, typical: nullableNumber, high: nullableNumber }).nullable()
});

export const soilSurveySchema = z.object({
  mapUnitKey: z.string(),
  mapUnitSymbol: z.string(),
  mapUnitName: z.string(),
  farmlandClass: z.string().nullable(),
  drainageClass: drainage,
  slopePct: nullableNumber,
  waterTableDepthCm: nullableNumber,
  bedrockDepthCm: nullableNumber,
  hydrologicGroup: z.string().nullable(),
  floodFrequency: z.string().nullable(),
  availableWaterCm: nullableNumber,
  components: z.array(soilComponentSchema),
  notSoil: z.boolean(),
  source: z.object({ name: z.literal(SOIL_SOURCE_NAME), fetchedAt: z.number() })
});

/** Body of `GET /api/soil/survey`. */
export const soilLookupSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('ok'), survey: soilSurveySchema }),
  z.object({ status: z.literal('no-data') }),
  z.object({ status: z.literal('unavailable') })
]);

/** Body of `GET /api/soil/areas/[id]`. */
export const soilAreaResponseSchema = z.union([
  z.object({ located: z.literal(false) }),
  z.object({ located: z.literal(true), approximate: z.boolean(), lookup: soilLookupSchema })
]);

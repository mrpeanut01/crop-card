/**
 * Planting footprint inside a bed (Phase 30, `crops.footprint_json`). Inches
 * from the bed's top-left corner in its own unrotated frame. Illustrative
 * layout for the garden designer only; never a geometry input.
 */

import { z } from 'zod';

export const SPACING_PATTERNS = ['square', 'offset', 'sfg'] as const;
export type SpacingPattern = (typeof SPACING_PATTERNS)[number];

export const PLANT_COUNT_PROVENANCES = ['data', 'manual', 'fallback'] as const;
export type PlantCountProvenance = (typeof PLANT_COUNT_PROVENANCES)[number];

const MAX_IN = 240_000;

export const footprintSchema = z.strictObject({
  x_in: z.number().min(0).max(MAX_IN),
  y_in: z.number().min(0).max(MAX_IN),
  w_in: z.number().positive().max(MAX_IN),
  l_in: z.number().positive().max(MAX_IN)
});

export type Footprint = z.infer<typeof footprintSchema>;

export const spacingInSchema = z.number().positive().max(600);

export function parseFootprint(json: string | null | undefined): Footprint | null {
  if (!json) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return null;
  }
  const parsed = footprintSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

export function serializeFootprint(fp: Footprint | null | undefined): string | null {
  return fp ? JSON.stringify(footprintSchema.parse(fp)) : null;
}

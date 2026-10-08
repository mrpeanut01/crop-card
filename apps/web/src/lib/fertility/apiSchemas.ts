import { z } from 'zod';
import { EXTRACTION_METHODS, LAB_RATINGS, UNITS_BASES } from './soilInterpret';

const nutrient = z.number().nonnegative().max(100_000);
const labRating = z.enum(LAB_RATINGS);

/** Body of `POST /api/fertility/soil-tests`. Nutrient values are entered
 *  exactly as the lab printed them; `unitsBasis` says whether that was ppm
 *  or lb/acre (missing means ppm). */
export const soilTestCreateSchema = z.object({
  blockId: z.string().min(1).max(200),
  sampledAt: z.number().int().optional(),
  lab: z.string().max(120).optional(),
  reportPdfUrl: z.string().url().optional(),
  ph: z.number().min(0).max(14).optional(),
  bufferPh: z.number().min(0).max(14).optional(),
  cec: z.number().nonnegative().max(1000).optional(),
  organicMatterPct: z.number().min(0).max(100).optional(),
  unitsBasis: z.enum(UNITS_BASES).optional(),
  extractionMethod: z.enum(EXTRACTION_METHODS).optional(),
  nitratePpm: nutrient.optional(),
  phosphorusPpm: nutrient.optional(),
  potassiumPpm: nutrient.optional(),
  caPpm: nutrient.optional(),
  mgPpm: nutrient.optional(),
  labRatings: z
    .object({
      p: labRating.optional(),
      k: labRating.optional(),
      ca: labRating.optional(),
      mg: labRating.optional()
    })
    .strict()
    .optional(),
  notes: z.string().max(500).optional(),
  /** A lab report already in the farm's documents (A-36). */
  documentId: z.string().min(1).max(200).optional()
});

export type SoilTestCreate = z.infer<typeof soilTestCreateSchema>;

/** Body of `POST /api/fertility/applications`. `stockItemId` names the
 *  inventory item the product came from; rate x block acres is taken from
 *  its on-hand lots (#763). `amendmentBatchId` names the
 *  manure or compost batch spread; `confirmCarryover` is the `factsHash`
 *  from a 409 `CARRYOVER_CONFIRM` the person confirmed (33C, M-45). */
export const fertilityApplicationCreateSchema = z.object({
  blockId: z.string().min(1),
  cropId: z.string().optional(),
  taskId: z.string().optional(),
  occurredAt: z.number().int().optional(),
  source: z.string().min(1).max(120),
  stockItemId: z.string().optional(),
  ratePerAcre: z.number().nonnegative(),
  rateUnit: z.string().min(1).max(40),
  /** Missing or null is stored as not known, never as 0 (#738). */
  nLbPerAcre: z.number().nonnegative().nullable().optional(),
  pLbPerAcre: z.number().nonnegative().nullable().optional(),
  kLbPerAcre: z.number().nonnegative().nullable().optional(),
  notes: z.string().max(500).optional(),
  amendmentBatchId: z.string().min(1).max(80).optional(),
  confirmCarryover: z.string().min(1).max(64).optional()
});

export type FertilityApplicationCreate = z.infer<typeof fertilityApplicationCreateSchema>;

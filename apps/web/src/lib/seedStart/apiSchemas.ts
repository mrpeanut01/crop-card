import { z } from 'zod';

/** Phase 32E (E1). Request schemas for seed starting. Client-safe, so the
 *  OpenAPI generator can publish them. */

const epochMs = z.number().int().min(0).max(8_640_000_000_000);
const id = z.string().min(1).max(128);

/** "Seed or seedling?" answers, spread into the three planting schemas
 *  (E1-1, E1-10). `startIndoors` is only read with `transplant`; it is not
 *  stored, the seed-start tasks are. */
export const plantingEstablishmentFields = {
  establishment: z.enum(['direct-seed', 'transplant']).optional(),
  startIndoors: z.boolean().optional(),
  /** The owner's own indoor sow date when the crop's timing is not known. */
  sowIndoorsOn: epochMs.optional()
};

export const plantingEstablishmentSchema = z.object(plantingEstablishmentFields);
export type PlantingEstablishment = z.infer<typeof plantingEstablishmentSchema>;

const trayFields = {
  trayLabel: z.string().trim().min(1).max(80).nullable().optional(),
  cells: z.number().int().min(1).max(2000).nullable().optional(),
  seedsPerCell: z.number().int().min(1).max(50).nullable().optional(),
  locationAreaId: id.nullable().optional(),
  locationText: z.string().trim().min(1).max(120).nullable().optional(),
  stockLotId: id.nullable().optional()
};

/** `POST /api/seed-starts` (owner). Replayable. */
export const seedStartCreateSchema = z
  .strictObject({
    cropId: id,
    sownAt: epochMs,
    ...trayFields
  })
  .describe('Log a seed-starting tray for a planting.');

/** `PATCH /api/seed-starts/[id]` (owner, online only). */
export const seedStartPatchSchema = z
  .strictObject({
    sownAt: epochMs.optional(),
    ...trayFields
  })
  .describe('Edit a tray.');

/** `POST /api/seed-starts/[id]/progress` (owner or helper). Replayable; the
 *  `seed-start` offline queue kind routes here. The count is absolute. */
export const seedStartProgressSchema = z
  .strictObject({
    germinatedCount: z.number().int().min(0).max(10_000).optional(),
    observedAt: epochMs.optional(),
    hardenStartedAt: epochMs.optional(),
    transplantedAt: epochMs.optional()
  })
  .refine(
    (v) =>
      v.germinatedCount !== undefined ||
      v.hardenStartedAt !== undefined ||
      v.transplantedAt !== undefined,
    { message: 'send a germinated count, a hardening date or a transplant date' }
  )
  .describe('Record germination or tray progress.');

export type SeedStartCreateRequest = z.infer<typeof seedStartCreateSchema>;
export type SeedStartPatchRequest = z.infer<typeof seedStartPatchSchema>;
export type SeedStartProgressRequest = z.infer<typeof seedStartProgressSchema>;

/** Tray fields sent to the offline snapshot and the Planting Card. */
export interface SeedStartTray {
  id: string;
  trayLabel: string | null;
  cells: number | null;
  seedsPerCell: number | null;
  germinatedCount: number | null;
  sownAt: number;
}

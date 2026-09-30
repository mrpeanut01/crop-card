import { z } from 'zod';
import { setPlacementPatchSchema } from '$lib/garden/api';
import { plantingEstablishmentFields } from '$lib/seedStart/apiSchemas';

/** Request body of `PATCH /api/crops/:id`, one variant per `action`. Kept free
 *  of server imports so the OpenAPI generator can publish it. */

export const CROP_STATUS_ACTIONS = [
  'mark-harvested',
  'archive',
  'mark-failed',
  'reactivate'
] as const;

export const cropStatusPatchSchema = z
  .object({
    action: z.enum(CROP_STATUS_ACTIONS),
    occurredAt: z.number().int().optional()
  })
  .describe('Change the planting status. Harvested and archived dates are stamped for you.');

export const cropSchedulePatchSchema = z
  .object({
    action: z.literal('set-schedule'),
    /** Epoch ms; null sends the planting back to the "to schedule" tray. */
    plantingDate: z.number().int().nullable(),
    blockId: z.string().min(1).optional()
  })
  .describe(
    'Set or clear the planting date, and optionally move it to another block. Open tasks tied to the planting move by the same number of days.'
  );

export const cropChangePluginPatchSchema = z
  .object({
    action: z.literal('change-plugin'),
    cropPluginId: z.string().min(1),
    varietyDisplayName: z.string().min(1).max(160).optional()
  })
  .describe(
    'Swap the crop plugin. Refused with 409 for the anchor of a planting group, and otherwise not available yet (501).'
  );

export const cropEditDetailsPatchSchema = z
  .object({
    action: z.literal('edit-details'),
    varietyDisplayName: z.string().min(1).max(160).optional(),
    quantityPlanted: z.number().nonnegative().nullable().optional(),
    quantityUnit: z.string().min(1).max(16).nullable().optional(),
    /** Which of the plugin's harvest windows to show; null shows them all. */
    harvestUseCases: z.array(z.string().min(1).max(40)).max(8).nullable().optional()
  })
  .describe('Edit the variety name, quantity and which harvest windows to show.');

export const cropUnschedulePatchSchema = z
  .object({ action: z.literal('unschedule') })
  .describe(
    'Take the planting off the schedule without deleting it. Its tasks are removed, its group is disbanded and it goes back to planned.'
  );

export const cropSplitPatchSchema = z
  .object({
    action: z.literal('split'),
    parts: z.number().int().min(2).max(12)
  })
  .describe('Split the planting into 2 to 12 parts on the same date and block.');

export const cropSetEstablishmentPatchSchema = z
  .object({
    action: z.literal('set-establishment'),
    establishment: z.enum(['direct-seed', 'transplant']).nullable(),
    startIndoors: plantingEstablishmentFields.startIndoors,
    sowIndoorsOn: plantingEstablishmentFields.sowIndoorsOn
  })
  .describe(
    'Owner only. Change "Seed or seedling?". Seed or bought seedlings skip the open seed-start tasks; seedlings started indoors write them again.'
  );

export const cropPatchSchema = z.discriminatedUnion('action', [
  cropSetEstablishmentPatchSchema,
  cropStatusPatchSchema,
  cropSchedulePatchSchema,
  cropChangePluginPatchSchema,
  cropEditDetailsPatchSchema,
  cropUnschedulePatchSchema,
  cropSplitPatchSchema,
  setPlacementPatchSchema
]);

export type CropPatchRequest = z.infer<typeof cropPatchSchema>;

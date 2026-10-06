import { z } from 'zod';
import { EDIT_CONFLICT_API_NOTE as EDIT_CONFLICT_NOTE } from '$lib/edits/conflict';
import { setPlacementPatchSchema } from '$lib/garden/api';
import { plantingEstablishmentFields } from '$lib/seedStart/apiSchemas';
import { SAVED_SOW_METHODS, TREE_SIZE_CLASSES } from '$lib/plan/spacingModel';

/** Request body of `PATCH /api/crops/:id`, one variant per `action`. Kept free
 *  of server imports so the OpenAPI generator can publish it. */

export const CROP_STATUS_ACTIONS = [
  'mark-harvested',
  'archive',
  'mark-failed',
  'reactivate'
] as const;

export const CROP_STATUSES = ['planned', 'active', 'harvested', 'failed', 'archived'] as const;

/** The status the device last saw before pressing a status button. Only
 *  `status` is checked: other keys are dropped, so another device's detail
 *  or date edit never blocks a status change (E-07). */
export const cropStatusBaseSchema = z.object({
  status: z.enum(CROP_STATUSES).nullable().optional()
});

export const cropStatusPatchSchema = z
  .object({
    action: z.enum(CROP_STATUS_ACTIONS),
    occurredAt: z.number().int().optional(),
    base: cropStatusBaseSchema.optional()
  })
  .describe(
    'Change the planting status. Harvested and archived dates are stamped for you.' +
      EDIT_CONFLICT_NOTE
  );

/** The values the device last saw for `set-schedule`'s fields (Phase 36, E-03). */
export const cropScheduleBaseSchema = z
  .object({
    plantingDate: z.number().int().nullable().optional(),
    blockId: z.string().max(200).nullable().optional()
  })
  .strict();

/** The values the device last saw for `edit-details`' fields (Phase 36, E-03). */
export const cropEditDetailsBaseSchema = z
  .object({
    varietyDisplayName: z.string().max(160).nullable().optional(),
    quantityPlanted: z.number().nullable().optional(),
    quantityUnit: z.string().max(16).nullable().optional(),
    harvestUseCases: z.array(z.string().max(40)).max(8).nullable().optional()
  })
  .strict();

export const cropSchedulePatchSchema = z
  .object({
    action: z.literal('set-schedule'),
    /** Epoch ms; null sends the planting back to the "to schedule" tray. */
    plantingDate: z.number().int().nullable(),
    blockId: z.string().min(1).optional(),
    base: cropScheduleBaseSchema.optional()
  })
  .describe(
    'Set or clear the planting date, and optionally move it to another block. Open tasks tied to the planting move by the same number of days.' +
      EDIT_CONFLICT_NOTE
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
    harvestUseCases: z.array(z.string().min(1).max(40)).max(8).nullable().optional(),
    base: cropEditDetailsBaseSchema.optional()
  })
  .describe(
    'Edit the variety name, quantity and which harvest windows to show.' + EDIT_CONFLICT_NOTE
  );

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

export const cropSetTreeSizePatchSchema = z
  .object({
    action: z.literal('set-tree-size'),
    /** Null is "Not sure". */
    treeSizeClass: z.enum(TREE_SIZE_CLASSES).nullable()
  })
  .describe(
    'Owner only. Set the tree size (dwarf, semi-dwarf or standard) the owner read off the nursery tag; null is "Not sure". It sets the spacing and the first-fruit advice only. Last write wins.'
  );

export const cropSetSowingMethodPatchSchema = z
  .object({
    action: z.literal('set-sowing-method'),
    /** Null goes back to the crop's default method. */
    sowingMethod: z.enum(SAVED_SOW_METHODS).nullable()
  })
  .describe(
    'Owner only. Set Drilled or Broadcast for a crop sown by area, so its seed amount uses that rate; null goes back to the default. Last write wins.'
  );

export const cropPatchSchema = z.discriminatedUnion('action', [
  cropSetEstablishmentPatchSchema,
  cropSetTreeSizePatchSchema,
  cropSetSowingMethodPatchSchema,
  cropStatusPatchSchema,
  cropSchedulePatchSchema,
  cropChangePluginPatchSchema,
  cropEditDetailsPatchSchema,
  cropUnschedulePatchSchema,
  cropSplitPatchSchema,
  setPlacementPatchSchema
]);

export type CropPatchRequest = z.infer<typeof cropPatchSchema>;

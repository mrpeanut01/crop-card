import { z } from 'zod';

const id = z.string().min(1).max(128);
const pluginId = z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/);

/** Body of `PUT /api/orchard/plantings/[id]/stage`: the stage the block's
 *  trees are at for this planting's calendar, or null to clear the mark. */
export const orchardStagePutSchema = z.strictObject({
  stageId: pluginId.nullable()
});

/** Body of `PUT /api/orchard/areas/[id]/audience` (owner only, OP-4): the
 *  guide this Area uses, or null for automatic. Choosing commercial needs
 *  `confirmCommercial: true`. */
export const orchardAudiencePutSchema = z.strictObject({
  audience: z.enum(['home', 'commercial']).nullable(),
  confirmCommercial: z.boolean().optional()
});

/** Body of `POST /api/orchard/plantings/[id]/scout-task` (OC-7). */
export const orchardScoutTaskSchema = z.strictObject({
  windowId: pluginId
});

export const orchardIdParam = id;

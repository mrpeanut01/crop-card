import { z } from 'zod';
import { CARE_PLAN_KINDS, MAX_LEAD_DAYS, isYmd } from './carePlans';

/** Request bodies of `/api/animals/:id/care-plans/**`. Owner writes only.
 *  Free of server imports so the OpenAPI generator can publish them. */

const ymd = z.string().refine(isYmd, 'use YYYY-MM-DD');
const title = z.string().trim().min(1).max(120);
const interval = z.number().int().min(1).max(3650);
const lead = z.number().int().min(0).max(MAX_LEAD_DAYS);

/** `POST /api/animals/:id/care-plans`. A plan repeats every `intervalDays`
 *  or happens once on `onceOn`. With neither date nor last dose, the plan
 *  is saved undated ("ask your vet") and never shows on /today. */
export const carePlanCreateSchema = z
  .strictObject({
    kind: z.enum(CARE_PLAN_KINDS),
    title,
    intervalDays: interval.nullable().optional(),
    onceOn: ymd.nullable().optional(),
    nextDueOn: ymd.nullable().optional(),
    lastDoneOn: ymd.nullable().optional(),
    leadDays: lead.optional(),
    productPluginId: z.string().min(1).max(128).nullable().optional()
  })
  .refine((v) => !(v.intervalDays && v.onceOn), {
    message: 'a plan repeats or happens once, not both',
    path: ['onceOn']
  })
  .refine((v) => !v.lastDoneOn || !!v.intervalDays, {
    message: 'a last date needs how often it repeats',
    path: ['lastDoneOn']
  });
export type CarePlanCreateInput = z.infer<typeof carePlanCreateSchema>;

/** `PATCH /api/animals/:id/care-plans/:planId`. Changing the cadence or the
 *  date aborts the plan's open tasks (`plan-edited`) and writes new ones;
 *  `active: false` ends it (`plan-ended`). */
export const carePlanPatchSchema = z
  .strictObject({
    kind: z.enum(CARE_PLAN_KINDS).optional(),
    title: title.optional(),
    intervalDays: interval.nullable().optional(),
    onceOn: ymd.nullable().optional(),
    nextDueOn: ymd.nullable().optional(),
    lastDoneOn: ymd.nullable().optional(),
    leadDays: lead.optional(),
    productPluginId: z.string().min(1).max(128).nullable().optional(),
    active: z.boolean().optional()
  })
  .refine((v) => !(v.intervalDays && v.onceOn), {
    message: 'a plan repeats or happens once, not both',
    path: ['onceOn']
  });
export type CarePlanPatchInput = z.infer<typeof carePlanPatchSchema>;

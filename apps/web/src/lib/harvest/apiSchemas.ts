import { z } from 'zod';

/** Where a harvest went (Phase 33B, B-27). Client-safe: no server imports, so
 *  the OpenAPI generator and the disposition panel share these. */

export const HARVEST_DISPOSITION_KINDS = ['sold', 'kept', 'donated', 'discarded'] as const;
export type HarvestDispositionKind = (typeof HARVEST_DISPOSITION_KINDS)[number];

export const DISPOSITION_KIND_LABEL: Record<HarvestDispositionKind, string> = {
  sold: 'Sold',
  kept: 'Kept',
  donated: 'Given away',
  discarded: 'Thrown out'
};

export const DISPOSITION_UNIT_SUGGESTIONS = [
  'lb',
  'kg',
  'bu',
  'dozen',
  'each',
  'bunch',
  'bale',
  'pint',
  'quart'
] as const;

export const MAX_DISPOSITION_QUANTITY = 10_000_000;

/** Hundredths, rounded half up. The epsilon keeps 1.005 from landing on
 *  100.4999 and rounding down. */
export function toHundredths(quantity: number): number {
  return Math.round(quantity * 100 + 1e-7);
}

export function fromHundredths(hundredths: number): number {
  return hundredths / 100;
}

const quantitySchema = z
  .number()
  .finite()
  .gt(0)
  .max(MAX_DISPOSITION_QUANTITY)
  .refine((q) => toHundredths(q) >= 1, { message: 'Quantity must be at least 0.01.' })
  .describe('How much, in `unit`. Stored to two decimal places.');

const unitSchema = z
  .string()
  .trim()
  .min(1)
  .max(20)
  .describe('Free text, for example lb, kg, bu, dozen, each, bunch, bale, pint or quart.');

const recipientSchema = z
  .string()
  .trim()
  .max(120)
  .nullable()
  .optional()
  .describe('Who got it. Only for sold and donated.');

const soldAsOrganicSchema = z
  .boolean()
  .nullable()
  .optional()
  .describe('Only for sold. Ignored (stored as null) when the farm has no organic status on file.');

/** Cross-field rules shared by create and the merged patch. Returns the
 *  plain-English problem, or null. */
export function dispositionProblem(v: {
  kind: HarvestDispositionKind;
  recipient?: string | null;
  soldAsOrganic?: boolean | null;
}): string | null {
  if (v.recipient && v.kind !== 'sold' && v.kind !== 'donated') {
    return 'Only a sale or a gift has a recipient.';
  }
  if (v.soldAsOrganic != null && v.kind !== 'sold') {
    return 'Only a sale can be marked sold as organic.';
  }
  return null;
}

export const dispositionCreateSchema = z
  .object({
    kind: z.enum(HARVEST_DISPOSITION_KINDS),
    quantity: quantitySchema,
    unit: unitSchema,
    occurredAt: z
      .number()
      .int()
      .optional()
      .describe('Epoch ms. From the start of the harvest day to now. Defaults to now.'),
    recipient: recipientSchema,
    soldAsOrganic: soldAsOrganicSchema
  })
  .strict()
  .superRefine((v, ctx) => {
    const problem = dispositionProblem(v);
    if (problem) ctx.addIssue({ code: 'custom', message: problem });
  });

export type DispositionCreate = z.infer<typeof dispositionCreateSchema>;

/** The offline queue payload: the create body plus the harvest id, which
 *  the sync queue moves into the path. */
export interface DispositionQueuePayload extends DispositionCreate {
  harvestEventId: string;
}

export const dispositionPatchSchema = z
  .object({
    kind: z.enum(HARVEST_DISPOSITION_KINDS).optional(),
    quantity: quantitySchema.optional(),
    unit: unitSchema.optional(),
    occurredAt: z.number().int().optional(),
    recipient: recipientSchema,
    soldAsOrganic: soldAsOrganicSchema,
    ledgerEntryId: z
      .string()
      .min(1)
      .max(128)
      .nullable()
      .optional()
      .describe('Owner only. Links or unlinks a sale in the ledger, even after the lock.')
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, { message: 'Nothing to change.' });

export type DispositionPatch = z.infer<typeof dispositionPatchSchema>;

export const DISPOSITION_FORCE_REASON_MIN = 3;
export const DISPOSITION_FORCE_REASON_MAX = 500;

export const dispositionDeleteQuerySchema = z.object({
  force: z.enum(['true', 'false']).optional(),
  reason: z.string().max(DISPOSITION_FORCE_REASON_MAX).optional()
});

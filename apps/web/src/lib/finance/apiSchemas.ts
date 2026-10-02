/**
 * Request schemas for the owner-only money endpoints (Phase 32F, F2).
 * Client-safe, so the OpenAPI generator and the drift test read the same
 * Zod schemas the routes validate with.
 */

import { z } from 'zod';
import { LEDGER_KINDS, isCategoryFor, type LedgerKind } from './categories';

/** F2-4: a positive whole number of cents, up to $10,000,000. */
export const MAX_AMOUNT_CENTS = 1_000_000_000;
/** An entry may be dated at most one day ahead. */
export const MAX_FUTURE_MS = 24 * 60 * 60 * 1000;
export const MAX_LABOUR_RATE_CENTS = 100_000;

const id = z.string().min(1).max(128);
const optionalId = id.nullable().optional();
const optionalText = (max: number) => z.string().trim().max(max).nullable().optional();

export const LEDGER_LINK_FIELDS = [
  'cropId',
  'fieldId',
  'blockId',
  'animalId',
  'animalGroupId',
  'stockLotId',
  'harvestEventId'
] as const;

export interface LedgerEntryShape {
  kind: LedgerKind;
  category: string;
  cropId?: string | null;
  fieldId?: string | null;
  blockId?: string | null;
  animalId?: string | null;
  animalGroupId?: string | null;
  stockLotId?: string | null;
  harvestEventId?: string | null;
}

/** F2-4, F2-5: the rules that span fields, shared by create and by a
 *  patch once it is merged over the stored entry. Null when it is fine. */
export function ledgerEntryProblem(v: LedgerEntryShape): string | null {
  if (!isCategoryFor(v.kind, v.category)) {
    return `That category is not one of the ${v.kind} categories.`;
  }
  const links = [v.cropId, v.fieldId, v.animalId, v.animalGroupId].filter((x) => !!x);
  if (links.length > 1) {
    return 'Link an entry to one crop, Area, animal or group, not several.';
  }
  if (v.blockId && !v.fieldId) return 'A bed needs its Area.';
  if (v.stockLotId && v.kind !== 'expense') return 'Only an expense can name a stock lot.';
  if (v.harvestEventId && v.kind !== 'income') return 'Only income can name a harvest.';
  return null;
}

const entryFields = {
  occurredAt: z.number().int().positive().describe('When the money moved (epoch ms).'),
  amountCents: z
    .number()
    .int()
    .min(1)
    .max(MAX_AMOUNT_CENTS)
    .describe('A positive whole number of US cents.'),
  category: z.string().min(1).max(40),
  description: optionalText(200),
  cropId: optionalId.describe('A planting; money is grouped by its crop.'),
  fieldId: optionalId.describe('An Area.'),
  blockId: optionalId.describe('A bed inside `fieldId`.'),
  animalId: optionalId,
  animalGroupId: optionalId,
  stockLotId: optionalId.describe(
    'Expenses only: the stock lot this purchase paid for. Counted as cash, never again as a crop cost.'
  ),
  harvestEventId: optionalId.describe('Income only: the harvest this sale came from.'),
  enterprise: optionalText(60).describe(
    'A free-text tag that groups entries with no crop or animal link.'
  ),
  quantity: z.number().positive().max(1_000_000_000).nullable().optional(),
  unit: optionalText(30)
};

export const ledgerEntryCreateSchema = z
  .object({
    kind: z.enum(LEDGER_KINDS),
    ...entryFields,
    dispositionId: optionalId.describe(
      'Income from a harvest only: the record of where the harvest went that this sale is for. Linked when it has no sale yet (Phase 33B).'
    )
  })
  .superRefine((v, ctx) => {
    const problem = ledgerEntryProblem(v);
    if (problem) ctx.addIssue({ code: 'custom', message: problem });
    if (v.dispositionId && (v.kind !== 'income' || !v.harvestEventId)) {
      ctx.addIssue({
        code: 'custom',
        message: 'Only income from a harvest can name where it went.'
      });
    }
  });

export type LedgerEntryCreate = z.infer<typeof ledgerEntryCreateSchema>;

export const ledgerEntryPatchSchema = z
  .object({
    kind: z.enum(LEDGER_KINDS).optional(),
    occurredAt: entryFields.occurredAt.optional(),
    amountCents: entryFields.amountCents.optional(),
    category: entryFields.category.optional(),
    description: entryFields.description,
    cropId: optionalId,
    fieldId: optionalId,
    blockId: optionalId,
    animalId: optionalId,
    animalGroupId: optionalId,
    stockLotId: optionalId,
    harvestEventId: optionalId,
    enterprise: entryFields.enterprise,
    quantity: entryFields.quantity,
    unit: entryFields.unit
  })
  .strict();

export type LedgerEntryPatch = z.infer<typeof ledgerEntryPatchSchema>;

export const labourRateSchema = z.object({
  centsPerHour: z
    .number()
    .int()
    .min(1)
    .max(MAX_LABOUR_RATE_CENTS)
    .nullable()
    .describe('One rate for everyone, in cents an hour; null clears it.')
});

export type LabourRate = z.infer<typeof labourRateSchema>;

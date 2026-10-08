/** #662: the harvest form's readings, as the record endpoint takes them.
 *  Free of i18n so the OpenAPI generator can import it. */

import { z } from 'zod';

export const TERMINATION_METHODS = [
  'roller-crimp',
  'mow',
  'mow-flame',
  'burndown',
  'incorporate'
] as const;
export type TerminationMethod = (typeof TERMINATION_METHODS)[number];

const pct = z.number().min(0).max(100);
const count = z.number().int().min(0).max(1_000_000);

export const harvestDetailsSchema = z
  .object({
    pickNumber: z.number().int().min(1).max(999).optional(),
    marketablePct: pct.optional(),
    cutNumber: z.number().int().min(1).max(999).optional(),
    cutHeightIn: z.number().min(0).max(120).optional(),
    boltObserved: z.boolean().optional(),
    dryPodLb: z.number().min(0).max(10_000_000).optional(),
    fruitCount: count.optional(),
    cureStartDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
    brix: z.number().min(0).max(80).optional(),
    ph: z.number().min(0).max(14).optional(),
    taGPerL: z.number().min(0).max(100).optional(),
    testWeightLbPerBu: z.number().min(0).max(100).optional(),
    earCount: count.optional(),
    terminationMethod: z.enum(TERMINATION_METHODS).optional(),
    residueCoverPct: pct.optional()
  })
  .strict();

export type HarvestDetails = z.infer<typeof harvestDetailsSchema>;

/** Drops unset fields; undefined when nothing is left. */
export function compactDetails(d: HarvestDetails): HarvestDetails | undefined {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(d)) {
    if (v === undefined || v === null || v === '' || v === false) continue;
    if (typeof v === 'number' && !Number.isFinite(v)) continue;
    out[k] = v;
  }
  return Object.keys(out).length ? (out as HarvestDetails) : undefined;
}

export function serializeDetails(d: HarvestDetails | undefined): string | null {
  const c = d ? compactDetails(d) : undefined;
  return c ? JSON.stringify(c) : null;
}

/** A stored row back to details; anything unreadable reads as none. */
export function parseStoredDetails(json: string | null | undefined): HarvestDetails | undefined {
  if (!json) return undefined;
  try {
    const parsed = harvestDetailsSchema.safeParse(JSON.parse(json));
    return parsed.success ? compactDetails(parsed.data) : undefined;
  } catch {
    return undefined;
  }
}

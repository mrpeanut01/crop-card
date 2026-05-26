/**
 * Sprint 3 (#173 / CT-W-004) — wizard draft persistence ("Save & resume
 * later"). One draft per (owner, plan_id); upsert on save, delete on
 * commit or explicit discard.
 *
 * Shape of `payloadJson` is captured by `WizardDraftPayload`. Schema is
 * intentionally fluid (JSON, not per-column) because the wizard's step
 * state evolves faster than migrations should. Validator below guards
 * the payload at read time; future shape changes need only update the
 * validator.
 *
 * Tenant-scoped per CLAUDE.md invariant 6. All reads/writes funnel
 * through `tenantWhere` / `tenantValues`.
 */

import { randomUUID } from 'node:crypto';
import { and, desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '$lib/db/client';
import { wizardDrafts } from '$lib/db/schema';
import { tenantValues, tenantWhere, withTenant } from '$lib/db/tenant';

export const draftPayloadSchema = z.object({
  /** Wizard step at the moment of save — must match an `AllocationWizard`
   *  step id so re-open lands on the right pane. */
  step: z.string().min(1),
  /** stockItemId → selected quantity. Persisted as a tuple list so JSON
   *  round-trip is order-stable. */
  selectedSeeds: z.array(z.tuple([z.string(), z.number()])).default([]),
  selectedBlockIds: z.array(z.string()).default([]),
  /** Optional last-seen chat draft so the user doesn't lose half a
   *  sentence when stepping away. */
  chatDraft: z.string().default(''),
  /** Free-form note from the user, surfaced on resume. */
  resumeNote: z.string().max(280).optional()
});

export type WizardDraftPayload = z.infer<typeof draftPayloadSchema>;

export interface WizardDraft {
  id: string;
  planId: string;
  step: string;
  payload: WizardDraftPayload;
  updatedAt: number;
}

function rowToDraft(row: typeof wizardDrafts.$inferSelect): WizardDraft | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(row.payloadJson);
  } catch {
    return null;
  }
  const validated = draftPayloadSchema.safeParse(parsed);
  if (!validated.success) return null;
  return {
    id: row.id,
    planId: row.planId,
    step: row.step,
    payload: validated.data,
    updatedAt: row.updatedAt.getTime()
  };
}

export function saveDraft(input: {
  planId: string;
  step: string;
  payload: WizardDraftPayload;
  createdByUserId?: string;
}): WizardDraft {
  const existing = db
    .select()
    .from(wizardDrafts)
    .where(withTenant(wizardDrafts, eq(wizardDrafts.planId, input.planId)))
    .get();

  const payloadJson = JSON.stringify(input.payload);
  const updatedAt = new Date(Date.now());

  if (existing) {
    const updated = db
      .update(wizardDrafts)
      .set({ step: input.step, payloadJson, updatedAt })
      .where(
        withTenant(
          wizardDrafts,
          and(eq(wizardDrafts.id, existing.id), eq(wizardDrafts.planId, input.planId))
        )
      )
      .returning()
      .get();
    const draft = rowToDraft(updated);
    if (!draft) throw new Error('saveDraft: payload validator regressed on round-trip');
    return draft;
  }

  const row = db
    .insert(wizardDrafts)
    .values(
      tenantValues({
        id: randomUUID(),
        planId: input.planId,
        step: input.step,
        payloadJson,
        updatedAt,
        createdByUserId: input.createdByUserId ?? null
      })
    )
    .returning()
    .get();
  const draft = rowToDraft(row);
  if (!draft) throw new Error('saveDraft: payload validator regressed on insert');
  return draft;
}

export function getDraft(planId: string): WizardDraft | null {
  const row = db
    .select()
    .from(wizardDrafts)
    .where(withTenant(wizardDrafts, eq(wizardDrafts.planId, planId)))
    .orderBy(desc(wizardDrafts.updatedAt))
    .limit(1)
    .get();
  return row ? rowToDraft(row) : null;
}

export function listDrafts(): WizardDraft[] {
  return db
    .select()
    .from(wizardDrafts)
    .where(tenantWhere(wizardDrafts))
    .orderBy(desc(wizardDrafts.updatedAt))
    .all()
    .map(rowToDraft)
    .filter((d): d is WizardDraft => d !== null);
}

export function deleteDraft(planId: string): boolean {
  const result = db
    .delete(wizardDrafts)
    .where(withTenant(wizardDrafts, eq(wizardDrafts.planId, planId)))
    .run();
  return result.changes > 0;
}

/**
 * POST /api/plan/inputs/commit (Phase 21 / B-28 / UC-37d).
 *
 * Persists the accepted applications + scout cadences from an
 * `InputsPlan` as `tasks` rows. The wizard's main commit step writes
 * the plantings themselves; this endpoint follows immediately after
 * to materialize the per-application + scout tasks against those
 * plantings.
 *
 * Idempotency:
 *
 *   For each block referenced in the commit, all OPEN tasks tagged
 *   `pluginTemplateKey === 'inputs-plan'` are deleted before insertion
 *   so re-running the wizard on the same plan produces a clean
 *   replacement rather than duplicates. Completed tasks are left
 *   untouched — the operator may have already executed against them
 *   and the historical link is load-bearing for the audit trail.
 *
 * Tasks created carry:
 *   - kind: 'primary'
 *   - blockId / cropId (cropId derived from planting → crop lookup
 *     when available; otherwise null)
 *   - scheduledFor: the planner's applicationDate
 *   - relatedEventTable: derived from the slot family (herbicide /
 *     insecticide / fungicide / fertilizer → spray_event /
 *     insecticide_event / fungicide_event / fertility_application)
 *   - pluginTemplateKey: 'inputs-plan'
 *   - recurrenceJson: for scout tasks, an RRULE-ish JSON describing
 *     the family-typical cadence
 *
 * No relatedEventId is set yet — the spray/insecticide/fungicide flows
 * patch that in via `completeTask({ eventTable, eventId })` when the
 * operator executes the task.
 */

import { json, type RequestHandler } from '@sveltejs/kit';
import { and, eq, isNull } from 'drizzle-orm';
import { z } from 'zod';

import { db } from '$lib/db/client';
import { listCrops } from '$lib/db/crops';
import { tasks } from '$lib/db/schema';
import { createTask, type RelatedEventTable } from '$lib/db/tasks';
import { withTenant } from '$lib/db/tenant';
import { currentUser } from '$lib/server/auth';
import { canMutate } from '$lib/server/session';
import { insertPlanRevision } from '$lib/plan/revisions';

const INPUTS_PLAN_TEMPLATE_KEY = 'inputs-plan';

const applicationSchema = z.object({
  id: z.string().min(1),
  plantingId: z.string().min(1),
  blockId: z.string().min(1),
  cropPluginId: z.string().min(1),
  slot: z.string().min(1),
  productPluginId: z.string().nullable(),
  productDisplayName: z.string().nullable(),
  productCategory: z.enum(['herbicide', 'insecticide', 'fungicide', 'fertilizer']),
  applicationDateMs: z.number().int(),
  rateAmount: z.number().nullable(),
  rateUnit: z.string().nullable(),
  acres: z.number().nonnegative(),
  totalAmount: z.number().nullable(),
  rationale: z.string()
});

const scoutTaskSchema = z.object({
  id: z.string().min(1),
  plantingId: z.string().min(1),
  blockId: z.string().min(1),
  cropPluginId: z.string().min(1),
  title: z.string().min(1),
  body: z.string(),
  recurrenceDays: z.number().int().positive(),
  windowStartMs: z.number().int(),
  windowEndMs: z.number().int()
});

const requestSchema = z.object({
  applications: z.array(applicationSchema).default([]),
  scoutTasks: z.array(scoutTaskSchema).default([]),
  /** Phase 25d (#89) — wizard tells the server whether the committed
   *  plan came from a deterministic-only run (`false`) or from an
   *  AI-refinement chain (`true`). Drives the `source` field on the
   *  `plan_revisions` row so ProvenancePanel renders the right badge. */
  aiRefined: z.boolean().optional()
});

/** Map a slot category to the RelatedEventTable union value that
 *  task-completion will patch with the executed event ID. */
function slotToEventTable(
  category: 'herbicide' | 'insecticide' | 'fungicide' | 'fertilizer'
): RelatedEventTable {
  if (category === 'herbicide') return 'spray_event';
  if (category === 'insecticide') return 'insecticide_event';
  if (category === 'fungicide') return 'fungicide_event';
  return 'fertility_application';
}

/** Format the operator-visible task title: slot + product + acres. */
function applicationTitle(app: z.infer<typeof applicationSchema>): string {
  const product = app.productDisplayName ?? 'pick product';
  const slot = app.slot.replace(/-/g, ' ');
  return `${slot}: ${product}`;
}

/** Format the task body — surfaces the rate + total so the operator
 *  has the dilution math anchor without re-running the planner. */
function applicationBody(app: z.infer<typeof applicationSchema>): string {
  const parts = [app.rationale];
  if (app.rateAmount != null && app.rateUnit) {
    parts.push(
      `Rate: ${app.rateAmount} ${app.rateUnit}/ac × ${app.acres.toFixed(2)} ac = ${
        app.totalAmount ?? 0
      } ${app.rateUnit} total.`
    );
  }
  if (!app.productPluginId) {
    parts.push(`No philosophy-compliant product selected — pick one before executing.`);
  }
  return parts.join('\n\n');
}

export const POST: RequestHandler = async (event) => {
  const auth = currentUser(event);
  if (!auth) return json({ error: 'authentication required' }, { status: 401 });
  if (!canMutate(auth.role)) {
    return json({ error: 'inspector role is read-only' }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await event.request.json();
  } catch {
    return json({ error: 'invalid JSON body' }, { status: 400 });
  }

  const parsed = requestSchema.safeParse(body);
  if (!parsed.success) {
    return json(
      {
        error: 'invalid request',
        issues: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message }))
      },
      { status: 400 }
    );
  }

  // Crop row lookup so the task carries cropId when the planting has
  // a corresponding persisted crop. Lookup is best-effort — if no
  // crop exists (e.g., commit ran before planting persistence
  // finished), the task still gets blockId.
  const allCrops = listCrops();
  const cropByBlockAndPluginId = new Map<string, string>();
  for (const c of allCrops) {
    cropByBlockAndPluginId.set(`${c.blockId}:${c.cropPluginId}`, c.id);
  }

  const blockIds = new Set<string>();
  for (const a of parsed.data.applications) blockIds.add(a.blockId);
  for (const s of parsed.data.scoutTasks) blockIds.add(s.blockId);

  // Idempotency — delete OPEN inputs-plan tasks for the affected
  // blocks. Completed / aborted tasks survive: their executed history
  // is load-bearing.
  const deletedIds: string[] = [];
  for (const blockId of blockIds) {
    const deleted = db
      .delete(tasks)
      .where(
        withTenant(
          tasks,
          and(
            eq(tasks.blockId, blockId),
            eq(tasks.pluginTemplateKey, INPUTS_PLAN_TEMPLATE_KEY),
            isNull(tasks.completedAt),
            isNull(tasks.abortedAt)
          )
        )
      )
      .returning({ id: tasks.id })
      .all();
    for (const row of deleted) deletedIds.push(row.id);
  }

  const created: string[] = [];

  for (const app of parsed.data.applications) {
    const cropId = cropByBlockAndPluginId.get(`${app.blockId}:${app.cropPluginId}`);
    const task = createTask({
      title: applicationTitle(app),
      body: applicationBody(app),
      kind: 'primary',
      blockId: app.blockId,
      cropId,
      scheduledFor: app.applicationDateMs,
      relatedEventTable: slotToEventTable(app.productCategory),
      pluginTemplateKey: INPUTS_PLAN_TEMPLATE_KEY,
      createdById: auth.id
    });
    created.push(task.id);
  }

  for (const scout of parsed.data.scoutTasks) {
    const cropId = cropByBlockAndPluginId.get(`${scout.blockId}:${scout.cropPluginId}`);
    const task = createTask({
      title: scout.title,
      body: `${scout.body}\n\nRepeats every ${scout.recurrenceDays} days through ${new Date(
        scout.windowEndMs
      ).toLocaleDateString()}.`,
      kind: 'primary',
      blockId: scout.blockId,
      cropId,
      scheduledFor: scout.windowStartMs,
      pluginTemplateKey: INPUTS_PLAN_TEMPLATE_KEY,
      createdById: auth.id
    });
    created.push(task.id);
  }

  // Phase 25d (#89) — write a `plan_revisions` row so the
  // ProvenancePanel on Plan v2 surfaces this wizard commit in the
  // revision chain. planId is the season-year identifier; payload is
  // the commit summary (kept small — full applications array would
  // bloat the audit log without adding diff value beyond the task
  // table itself).
  const year = new Date().getUTCFullYear();
  try {
    insertPlanRevision({
      planId: `season-${year}`,
      source: parsed.data.aiRefined ? 'ai-refinement' : 'wizard',
      createdByUserId: auth.id,
      payload: {
        kind: 'inputs-plan-commit',
        applications: parsed.data.applications.length,
        scoutTasks: parsed.data.scoutTasks.length,
        blocksTouched: Array.from(blockIds),
        createdTaskIds: created.length,
        replacedTaskIds: deletedIds.length,
        note:
          parsed.data.applications.length === 0 && parsed.data.scoutTasks.length === 0
            ? 'Cleared inputs plan'
            : `Committed ${parsed.data.applications.length} applications + ${parsed.data.scoutTasks.length} scout tasks across ${blockIds.size} block${blockIds.size === 1 ? '' : 's'}`
      }
    });
  } catch (err) {
    console.error('[plan-revisions] failed to write wizard revision', err);
  }

  return json({
    createdTaskIds: created,
    replacedTaskIds: deletedIds,
    summary: {
      applications: parsed.data.applications.length,
      scoutTasks: parsed.data.scoutTasks.length,
      blocksTouched: blockIds.size
    }
  });
};

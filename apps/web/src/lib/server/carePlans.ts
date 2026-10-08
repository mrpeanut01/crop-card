/**
 * Care plans into tasks and back (Phase 32D, D1).
 *
 * - `materializeCareTasks` writes the task for each active, dated plan due
 *   within `max(lead_days, 30)` days. Only the push tick and the /today
 *   loader call it (D0-2); it is a system write (no `created_by`) inside the
 *   tenant context. It also ends open tasks whose plan or animal is gone.
 * - `closeCareTask` is Done and Skip for a care task, from
 *   `POST /api/tasks/close` and `PATCH /api/tasks/:id`. A hold-bearing kind
 *   must carry the treatment, which goes through the 32C health writer and
 *   the hold guard in the same transaction as the task close and the plan's
 *   roll forward (D0-5). Nothing here is gated by the season close-out.
 */

import { json, type RequestEvent } from '@sveltejs/kit';
import { db } from '$lib/db/client';
import {
  careSubjectKey,
  careSubjects,
  deleteCarePlan,
  getCarePlan,
  insertCarePlan,
  listActiveDatedCarePlans,
  listCarePlansForSubject,
  updateCarePlan,
  type CarePlan,
  type CareSubject
} from '$lib/db/animalCarePlans';
import { listOpenCareTasks, listOpenTasksForPlan, upsertCareTask } from '$lib/db/careTasks';
import { abortTask, completeTask, getTask, updateTask, type Task } from '$lib/db/tasks';
import { getHealthEvent, type AnimalHealthEvent } from '$lib/db/animalHealth';
import { ymdInZone } from '$lib/prefs';
import type { AnimalSubjectType } from '$lib/animals/model';
import {
  CARE_TO_HEALTH_KIND,
  PLAN_EDITED,
  PLAN_ENDED,
  addDaysYmd,
  careTaskId,
  careTaskTitle,
  daysBetween,
  defaultLeadDays,
  horizonDays,
  isHoldBearingCare,
  nextDueAfterDone,
  nextDueAfterSkip,
  parseCareMeta,
  ymdToMs,
  type CarePlanKind,
  type CareTaskMeta
} from '$lib/animals/carePlans';
import type { HealthRecordInput } from '$lib/animals/recordApiSchemas';
import type { TaskCloseInput } from '$lib/tasks/apiSchemas';
import type { AuthenticatedUser } from './auth';
import { isInteractiveOwner } from './interactiveOwner';
import { writeRecord } from './recordWrite';
import { tryGuardedHoldWrite } from './holdGuard';
import { healthRecordResponse, prepareHealthRecord, writeHealthRecord } from './healthRecordWrite';
import { getDataKinds } from './registry';
import { recordTaskTime } from './taskTime';

const DAY_MS = 86_400_000;

// ─── Materialization ────────────────────────────────────────────────────

export interface MaterializeResult {
  /** Tasks written or reopened. */
  written: number;
  /** Open tasks ended because their plan or animal is gone. */
  ended: number;
  /** The farm's open care tasks after the pass. */
  open: Task[];
  subjects: Map<string, CareSubject>;
  /** Active dated plans, by id. */
  plans: Map<string, CarePlan>;
}

function taskWrite(plan: CarePlan, subject: CareSubject) {
  return {
    meta: {
      subjectType: plan.subjectType,
      subjectId: plan.subjectId,
      planId: plan.id,
      dueOn: plan.nextDueOn!,
      careKind: plan.kind,
      leadDays: plan.leadDays
    },
    title: careTaskTitle(plan.title, subject.name)
  };
}

export function materializeCareTasks(now: number, timeZone: string): MaterializeResult {
  const plans = listActiveDatedCarePlans();
  const empty = {
    written: 0,
    ended: 0,
    open: [] as Task[],
    subjects: new Map<string, CareSubject>(),
    plans: new Map<string, CarePlan>()
  };
  if (plans.length === 0) return empty;
  const today = ymdInZone(now, timeZone);
  const openBefore = listOpenCareTasks();
  const refs = [
    ...plans.map((p) => ({ subjectType: p.subjectType, subjectId: p.subjectId })),
    ...openBefore.flatMap((t) => {
      const m = parseCareMeta(t.recurrenceJson);
      return m ? [{ subjectType: m.subjectType, subjectId: m.subjectId }] : [];
    })
  ];
  const subjects = careSubjects(refs);
  const byId = new Map(plans.map((p) => [p.id, p]));
  // An open task under the same id makes the upsert a no-op (it only
  // reopens a task the engine aborted), so those plans are skipped.
  const openIds = new Set(openBefore.map((t) => t.id));
  const due = plans.flatMap((plan) => {
    const subject = subjects.get(careSubjectKey(plan.subjectType, plan.subjectId));
    if (!subject?.active) return [];
    if (daysBetween(today, plan.nextDueOn!) > horizonDays(plan.leadDays)) return [];
    if (openIds.has(careTaskId(plan.id, plan.nextDueOn!))) return [];
    return [taskWrite(plan, subject)];
  });
  let written = 0;
  if (due.length > 0) {
    db.transaction(() => {
      for (const write of due) if (upsertCareTask(write)) written++;
    });
  }
  const swept = sweep(written > 0 ? listOpenCareTasks() : openBefore, byId, subjects, now);
  return { written, ended: swept.ended, open: swept.open, subjects, plans: byId };
}

/** Ends open care tasks whose plan was deleted or turned off, or whose
 *  animal or group is no longer here (D0-3, `plan-ended`). */
function sweep(
  open: Task[],
  activePlans: Map<string, CarePlan>,
  subjects: Map<string, CareSubject>,
  now: number
): { ended: number; open: Task[] } {
  const keep: Task[] = [];
  let ended = 0;
  for (const t of open) {
    const meta = parseCareMeta(t.recurrenceJson);
    const plan = meta ? (activePlans.get(meta.planId) ?? getCarePlan(meta.planId)) : undefined;
    const subject = meta ? subjects.get(careSubjectKey(meta.subjectType, meta.subjectId)) : null;
    const subjectGone = subject !== undefined && subject !== null && !subject.active;
    if (!meta || !plan || !plan.active || subjectGone) {
      abortTask(t.id, PLAN_ENDED, true, now);
      ended++;
      continue;
    }
    keep.push(t);
  }
  return { ended, open: keep };
}

/** Writes the task for one plan now, whatever its horizon rule says, when
 *  it is due inside the horizon. Used after an owner edits a plan. */
function rematerializePlan(plan: CarePlan, now: number, timeZone: string): void {
  if (!plan.active || !plan.nextDueOn) return;
  const subject = careSubjects([plan]).get(careSubjectKey(plan.subjectType, plan.subjectId));
  if (!subject?.active) return;
  const today = ymdInZone(now, timeZone);
  if (daysBetween(today, plan.nextDueOn) > horizonDays(plan.leadDays)) return;
  upsertCareTask(taskWrite(plan, subject));
}

export function endOpenTasksForPlan(planId: string, reason: string, now = Date.now()): number {
  let n = 0;
  for (const t of listOpenTasksForPlan(planId)) {
    abortTask(t.id, reason, true, now);
    n++;
  }
  return n;
}

/** An animal or group left, died, was sold or slaughtered, or was
 *  archived: its open care tasks end (`plan-ended`). The plans stay, so a
 *  correction back to "here" brings them back. */
export function endCareForSubject(
  subjectType: AnimalSubjectType,
  subjectId: string,
  now = Date.now()
): number {
  let n = 0;
  for (const p of listCarePlansForSubject(subjectType, subjectId)) {
    n += endOpenTasksForPlan(p.id, PLAN_ENDED, now);
  }
  return n;
}

// ─── Plan edits ─────────────────────────────────────────────────────────

export interface PlanChange {
  kind?: CarePlanKind;
  title?: string;
  intervalDays?: number | null;
  onceOn?: string | null;
  nextDueOn?: string | null;
  lastDoneOn?: string | null;
  leadDays?: number;
  productPluginId?: string | null;
  active?: boolean;
}

/** The next due day a create or edit implies: an explicit date, else the
 *  last dose plus the interval, else the one-off day. */
export function impliedNextDue(
  change: PlanChange,
  current: Pick<CarePlan, 'intervalDays' | 'onceOn' | 'nextDueOn'> | null
): string | null | undefined {
  if (change.nextDueOn !== undefined) return change.nextDueOn;
  const interval =
    change.intervalDays !== undefined ? change.intervalDays : (current?.intervalDays ?? null);
  if (change.lastDoneOn && interval) return addDaysYmd(change.lastDoneOn, interval);
  if (change.onceOn !== undefined) return change.onceOn;
  return current ? undefined : null;
}

export function createCarePlan(
  subjectType: AnimalSubjectType,
  subjectId: string,
  change: PlanChange & { kind: CarePlanKind; title: string },
  now = Date.now()
): CarePlan {
  return insertCarePlan(
    {
      subjectType,
      subjectId,
      kind: change.kind,
      title: change.title,
      productPluginId: change.productPluginId ?? null,
      intervalDays: change.intervalDays ?? null,
      onceOn: change.onceOn ?? null,
      nextDueOn: impliedNextDue(change, null) ?? null,
      leadDays: change.leadDays ?? defaultLeadDays(change.kind),
      provenance: 'manual'
    },
    now
  );
}

/** An owner edit. Open tasks are aborted (`plan-edited`) and rewritten from
 *  the edited plan; turning a plan off ends them (`plan-ended`). */
export function editCarePlan(
  plan: CarePlan,
  change: PlanChange,
  timeZone: string,
  now = Date.now()
): CarePlan | undefined {
  return db.transaction(() => {
    const next = impliedNextDue(change, plan);
    const updated = updateCarePlan(
      plan.id,
      {
        kind: change.kind,
        title: change.title,
        productPluginId: change.productPluginId,
        intervalDays: change.intervalDays,
        onceOn: change.onceOn,
        nextDueOn: next,
        leadDays: change.leadDays,
        active: change.active,
        provenance: 'manual'
      },
      now
    );
    if (!updated) return undefined;
    endOpenTasksForPlan(plan.id, updated.active ? PLAN_EDITED : PLAN_ENDED, now);
    rematerializePlan(updated, now, timeZone);
    return updated;
  });
}

export function removeCarePlan(plan: CarePlan, now = Date.now()): boolean {
  return db.transaction(() => {
    endOpenTasksForPlan(plan.id, PLAN_ENDED, now);
    return deleteCarePlan(plan.id);
  });
}

/** Species defaults (D2-09): an interval only when the species plugin
 *  carries a sourced one, and never a due date, so the plan waits undated
 *  ("ask your vet") until the owner says when it was last done. */
export async function seedSpeciesCarePlans(
  subjectType: AnimalSubjectType,
  subjectId: string,
  speciesId: string,
  now = Date.now()
): Promise<CarePlan[]> {
  const species = (await getDataKinds()).species.get(speciesId);
  const defaults = species?.careDefaults ?? [];
  if (defaults.length === 0) return [];
  const have = listCarePlansForSubject(subjectType, subjectId);
  const out: CarePlan[] = [];
  for (const d of defaults) {
    if (have.some((p) => p.kind === d.kind && p.title === d.title)) continue;
    out.push(
      insertCarePlan(
        {
          subjectType,
          subjectId,
          kind: d.kind,
          title: d.title,
          intervalDays: d.intervalDays ?? null,
          nextDueOn: null,
          leadDays: defaultLeadDays(d.kind),
          provenance: 'plugin'
        },
        now
      )
    );
  }
  return out;
}

export function speciesCareNote(
  species: { careDefaults?: { kind: string; title: string; note?: string }[] } | undefined,
  plan: Pick<CarePlan, 'kind' | 'title'>
): string | null {
  return (
    species?.careDefaults?.find((d) => d.kind === plan.kind && d.title === plan.title)?.note ?? null
  );
}

// ─── Closing a care task ────────────────────────────────────────────────

export const CARE_COPY = {
  CARE_NEEDS_RECORD:
    'Record what was given. Open Animal care on the Today page and fill in the form, so the hold is worked out.',
  CARE_SKIP_CHOICE: 'Say whether to skip this one or be reminded again in a few days.',
  SUBJECT_MISMATCH: 'The treatment is for a different animal than this task.',
  NEXT_DUE_OWNER: 'Only the owner can change the next due date. It was set from the plan.',
  TASK_ALREADY_CLOSED:
    'This job was already closed another way. The treatment was still saved, so any hold is on file.',
  TASK_ALREADY_DONE:
    'This job was already done and its treatment is on file, so nothing new was saved. If a second dose was really given, record it on the Health page.'
} as const;

function refuse(status: number, code: keyof typeof CARE_COPY): Response {
  return json({ error: CARE_COPY[code], code }, { status });
}

class AlreadyClosed extends Error {}

const SAME_DOSE_WINDOW_MS = DAY_MS;

function productKey(e: {
  productPluginId: string | null;
  productName: string | null;
  stockItemId: string | null;
}): string | null {
  if (e.productPluginId) return `p:${e.productPluginId}`;
  if (e.stockItemId) return `s:${e.stockItemId}`;
  const name = e.productName?.trim().toLowerCase().replace(/\s+/g, ' ');
  return name ? `n:${name}` : null;
}

/** The dose already saved with this closed task when a new one repeats it:
 *  same subject, kind and product, given within a day. A retry with a fresh
 *  client id, or a second device tapping Done from a stale page, is then a
 *  duplicate and must not write a second dose or take a second bottle off
 *  stock. A different product, or a dose more than a day apart, still saves,
 *  so a real second dose and its hold are never dropped. */
export function duplicateOfTaskDose(
  task: Pick<Task, 'relatedEventTable' | 'relatedEventId'>,
  dose: {
    subjectType: AnimalSubjectType;
    subjectId: string;
    kind: string;
    productPluginId: string | null;
    productName: string | null;
    stockItemId: string | null;
    administeredAt: number;
  }
): AnimalHealthEvent | null {
  if (task.relatedEventTable !== 'animal_health_event' || !task.relatedEventId) return null;
  const prior = getHealthEvent(task.relatedEventId);
  if (!prior) return null;
  if (prior.subjectType !== dose.subjectType || prior.subjectId !== dose.subjectId) return null;
  if (prior.kind !== dose.kind) return null;
  const a = productKey(prior);
  const b = productKey(dose);
  if (a !== null && b !== null && a !== b) return null;
  if ((a === null) !== (b === null)) return null;
  if (Math.abs(prior.administeredAt - dose.administeredAt) > SAME_DOSE_WINDOW_MS) return null;
  return prior;
}

class DuplicateDose extends Error {
  constructor(readonly prior: AnimalHealthEvent) {
    super('duplicate dose');
  }
}

/** Roll the plan forward, but only from the task that is its current due
 *  day, so a stale or duplicate close never moves it twice. With no next
 *  day, a one-off plan ends; a repeating plan with no interval stays on and
 *  waits undated ("ask your vet", D2-09), so a booster never vanishes. */
function rollPlan(
  meta: CareTaskMeta,
  next: string | null,
  manual: boolean,
  now: number
): CarePlan | null {
  const plan = getCarePlan(meta.planId);
  if (!plan || plan.nextDueOn !== meta.dueOn) return null;
  if (next === null) {
    const oneOff = plan.onceOn !== null && !plan.intervalDays;
    return (
      updateCarePlan(plan.id, { nextDueOn: null, ...(oneOff ? { active: false } : {}) }, now) ??
      null
    );
  }
  return (
    updateCarePlan(
      plan.id,
      { nextDueOn: next, ...(manual ? { provenance: 'manual' as const } : {}) },
      now
    ) ?? null
  );
}

export interface CloseContext {
  event: Pick<RequestEvent, 'locals' | 'request'>;
  user: AuthenticatedUser;
  task: Task;
  meta: CareTaskMeta;
  input: Pick<
    TaskCloseInput,
    | 'action'
    | 'reason'
    | 'occurredAt'
    | 'healthEvent'
    | 'nextDueOn'
    | 'careSkip'
    | 'snoozeDays'
    | 'minutes'
  >;
  timeZone: string;
  now?: number;
}

export async function closeCareTask(ctx: CloseContext): Promise<Response> {
  const { event, user, task, meta, input, timeZone } = ctx;
  const now = ctx.now ?? Date.now();
  const at = Math.min(now, Math.max(now - 30 * DAY_MS, input.occurredAt ?? now));
  const plan = getCarePlan(meta.planId);
  const cadence = { intervalDays: plan?.intervalDays ?? null, onceOn: plan?.onceOn ?? null };
  const warnings: { code: string; message: string }[] = [];

  if (input.action === 'abort') {
    const choice = input.careSkip ?? (isHoldBearingCare(meta.careKind) ? null : 'skip-this');
    if (!choice) return refuse(422, 'CARE_SKIP_CHOICE');
    if (choice === 'snooze') {
      const until = addDaysYmd(ymdInZone(now, timeZone), input.snoozeDays ?? 1);
      const snoozed = updateTask(task.id, { scheduledFor: ymdToMs(until), isUserEdit: true });
      return json({ task: snoozed, alreadyClosed: false, snoozedUntil: until });
    }
    try {
      const out = writeRecord(event, () => {
        const fresh = getTask(task.id);
        if (!fresh || fresh.completedAt !== undefined || fresh.abortedAt !== undefined) {
          throw new AlreadyClosed();
        }
        const closed = abortTask(task.id, input.reason?.trim() || 'skipped', true, at);
        const rolled = rollPlan(meta, nextDueAfterSkip(cadence, meta.dueOn), false, now);
        return { closed, rolled };
      });
      return json({
        task: out.closed,
        alreadyClosed: false,
        nextDueOn: out.rolled?.nextDueOn ?? null
      });
    } catch (e) {
      if (e instanceof AlreadyClosed) return json({ task: getTask(task.id), alreadyClosed: true });
      throw e;
    }
  }

  const doneOn = ymdInZone(at, timeZone);
  let next = nextDueAfterDone(cadence, doneOn);
  let manual = false;
  if (input.nextDueOn) {
    if (isInteractiveOwner(event, user)) {
      manual = input.nextDueOn !== next;
      next = input.nextDueOn;
    } else {
      warnings.push({ code: 'NEXT_DUE_OWNER', message: CARE_COPY.NEXT_DUE_OWNER });
    }
  }

  const healthKind = CARE_TO_HEALTH_KIND[meta.careKind];
  let health: HealthRecordInput | null = null;
  if (healthKind) {
    if (input.healthEvent) {
      if (
        input.healthEvent.subjectType !== meta.subjectType ||
        input.healthEvent.subjectId !== meta.subjectId
      ) {
        return refuse(400, 'SUBJECT_MISMATCH');
      }
      health = { ...input.healthEvent, kind: healthKind };
    } else if (isHoldBearingCare(meta.careKind)) {
      return refuse(422, 'CARE_NEEDS_RECORD');
    } else {
      health = {
        subjectType: meta.subjectType,
        subjectId: meta.subjectId,
        kind: healthKind,
        administeredAt: at
      };
    }
  }

  if (!health) {
    try {
      const out = writeRecord(event, () => {
        const fresh = getTask(task.id);
        if (!fresh || fresh.completedAt !== undefined || fresh.abortedAt !== undefined) {
          throw new AlreadyClosed();
        }
        const closed = completeTask(task.id, { occurredAt: at });
        const rolled = rollPlan(meta, next, manual, now);
        const time = logTime(ctx, at);
        return { closed, rolled, time };
      });
      return json({
        task: out.closed,
        alreadyClosed: false,
        nextDueOn: out.rolled?.nextDueOn ?? null,
        warnings,
        ...(out.time ? { timeSaved: true } : {})
      });
    } catch (e) {
      if (e instanceof AlreadyClosed) return json({ task: getTask(task.id), alreadyClosed: true });
      throw e;
    }
  }

  const ready = await prepareHealthRecord(event, user, health);
  if (!ready.ok) return ready.response;
  const { prepared } = ready;
  let guarded;
  try {
    guarded = await tryGuardedHoldWrite(
      event,
      user,
      () => {
        const fresh = getTask(task.id);
        const open = !!fresh && fresh.completedAt === undefined && fresh.abortedAt === undefined;
        if (!open && !input.healthEvent) throw new AlreadyClosed();
        if (!open && fresh) {
          const stock = prepared.ctx.stock;
          const prior = duplicateOfTaskDose(fresh, {
            subjectType: prepared.ctx.input.subjectType,
            subjectId: prepared.ctx.input.subjectId,
            kind: prepared.ctx.input.kind,
            productPluginId: stock.productPluginId,
            productName: stock.productName,
            stockItemId: stock.stockItemId,
            administeredAt: prepared.ctx.input.administeredAt
          });
          if (prior) throw new DuplicateDose(prior);
        }
        const saved = writeHealthRecord(prepared);
        const time = logTime(ctx, at);
        if (!open) return { saved, closed: fresh ?? null, rolled: null, late: true, time };
        const closed = completeTask(task.id, {
          eventTable: 'animal_health_event',
          eventId: saved.row.id,
          occurredAt: at
        });
        const rolled = rollPlan(meta, next, manual, now);
        return { saved, closed, rolled, late: false, time };
      },
      { dated: true }
    );
  } catch (e) {
    if (e instanceof AlreadyClosed) return json({ task: getTask(task.id), alreadyClosed: true });
    if (e instanceof DuplicateDose) {
      return json({
        task: getTask(task.id),
        alreadyClosed: true,
        duplicateOf: e.prior.id,
        warnings: [{ code: 'TASK_ALREADY_DONE', message: CARE_COPY.TASK_ALREADY_DONE }]
      });
    }
    throw e;
  }
  if (!guarded.ok) return guarded.response;
  const { saved, closed, rolled, late, time } = guarded.value;
  if (late) warnings.push({ code: 'TASK_ALREADY_CLOSED', message: CARE_COPY.TASK_ALREADY_CLOSED });
  const body = healthRecordResponse(prepared, saved);
  return json({
    ...body,
    warnings: [...((body.warnings as unknown[]) ?? []), ...warnings],
    task: closed,
    alreadyClosed: late,
    nextDueOn: rolled?.nextDueOn ?? null,
    ...(time ? { timeSaved: true } : {})
  });
}

/** Time on Done (32F, F1-12): the person closing, inside the close. */
function logTime(ctx: CloseContext, at: number) {
  return recordTaskTime({
    task: ctx.task,
    userId: ctx.user.id,
    minutes: ctx.input.minutes,
    occurredAt: at,
    request: ctx.event.request
  });
}

/** A care task's plan metadata, or null for any other task. */
export function careMetaOf(task: Pick<Task, 'category' | 'recurrenceJson'>): CareTaskMeta | null {
  if (task.category !== 'animal-care') return null;
  return parseCareMeta(task.recurrenceJson);
}

/**
 * Phase 32E (E1-7, E1-10). The one writer of seed-start tasks. Called
 * inside the planting write's transaction by every endpoint that creates or
 * dates a transplant planting. A task's id is `tk_seed_<cropId>_<step>`, so
 * racing writers and offline replays land on the same row: it is inserted
 * once, and later calls only update its date, title and body while it is
 * open. A done or skipped row is never touched.
 */

import { and, eq, inArray, isNull, like, or, sql } from 'drizzle-orm';
import { db } from '$lib/db/client';
import { blocks, tasks } from '$lib/db/schema';
import { getCrop, setEstablishment } from '$lib/db/crops';
import { stampTraysTransplanted } from '$lib/db/seedStarts';
import { deleteSetting, getSetting, setSetting } from '$lib/db/settings';
import type { PlantingEstablishment } from '$lib/seedStart/apiSchemas';
import { tenantValues, withTenant } from '$lib/db/tenant';
import { t, type MessageKey } from '$lib/i18n';
import {
  SOW_AFTER_TRANSPLANT_NOTE,
  resolveSeedStartTiming,
  seedStartPlan,
  seedStartStepOf,
  seedStartTaskId,
  seedStartTaskText,
  seedStartTemplateKey,
  type SeedStartPlan,
  type SeedStartPluginSlice,
  type SeedStartStep
} from '$lib/schedule/seedStart';

/** The abort reason the seed-start writer itself uses; only rows aborted
 *  for it are reopened when the grower starts indoors again. */
export const SEED_START_ABORT_REASON = 'plan-edited';

const CATEGORY: Record<SeedStartStep, 'plant' | 'other'> = {
  sow: 'plant',
  harden: 'other',
  transplant: 'plant'
};

export interface SeedStartTaskInput {
  cropId: string;
  blockId: string;
  cropName: string;
  bedName: string;
  inGroundMs: number;
  plugin: SeedStartPluginSlice;
  sowIndoorsOnMs?: number;
  nowMs?: number;
}

export interface SeedStartTaskResult {
  plan: SeedStartPlan;
  taskIds: string[];
  /** Plain lines for the response and form (E0-4). */
  notes: string[];
}

export function materializeSeedStartTasks(input: SeedStartTaskInput): SeedStartTaskResult {
  const nowMs = input.nowMs ?? Date.now();
  const overrides =
    input.sowIndoorsOnMs !== undefined ? { sowIndoorsOnMs: input.sowIndoorsOnMs } : undefined;
  const timing = resolveSeedStartTiming(input.plugin, overrides);
  const plan = seedStartPlan(input.inGroundMs, timing, overrides);
  const taskIds: string[] = [];
  for (const s of plan.steps) {
    const id = seedStartTaskId(input.cropId, s.step);
    const text = seedStartTaskText({
      step: s.step,
      cropName: input.cropName,
      bedName: input.bedName,
      timing,
      dateMs: s.dateMs,
      nowMs,
      sowManual: s.step === 'sow' && s.source === 'manual'
    });
    const scheduledFor = new Date(s.dateMs);
    db.insert(tasks)
      .values(
        tenantValues({
          id,
          title: text.title,
          body: text.body || null,
          kind: 'primary' as const,
          cropId: input.cropId,
          blockId: input.blockId,
          scheduledFor,
          category: CATEGORY[s.step],
          pluginTemplateKey: seedStartTemplateKey(input.cropId, s.step),
          createdById: null
        })
      )
      .onConflictDoUpdate({
        target: tasks.id,
        set: {
          title: text.title,
          body: text.body || null,
          scheduledFor,
          blockId: input.blockId,
          abortedAt: null,
          abortReason: null
        },
        setWhere: and(
          eq(tasks.ownerId, sql`excluded.owner_id`),
          isNull(tasks.completedAt),
          or(isNull(tasks.abortedAt), eq(tasks.abortReason, SEED_START_ABORT_REASON))
        )
      })
      .run();
    taskIds.push(id);
  }
  return { plan, taskIds, notes: seedStartNotes(plan) };
}

const NOT_DATED_NOTE = 'Seed-start tasks are made once the planting has a date.';
const ALREADY_IN_GROUND_NOTE = 'Already in the ground, so no seed-start tasks were made.';
const DAY_MS = 86_400_000;

/** #645: a planting whose in-ground date is a full day or more behind now
 *  is already planted (an orchard set out years ago, a backdated record),
 *  so there is nothing left to sow, harden off or transplant. */
export function isAlreadyInGround(inGroundMs: number, nowMs: number): boolean {
  return inGroundMs + DAY_MS <= nowMs;
}
const HARDEN_UNKNOWN_NOTE = 'Hardening-off timing is not known for this crop.';
const SOW_UNKNOWN_NOTE =
  'Indoor start timing is not known for this crop. Set the sow date yourself.';

const NOTE_KEYS: Record<string, MessageKey> = {
  [SOW_AFTER_TRANSPLANT_NOTE]: 'sched.sowAfterTransplant',
  [SOW_UNKNOWN_NOTE]: 'sched.sowTimingUnknown',
  [HARDEN_UNKNOWN_NOTE]: 'sched.hardenUnknownNote',
  [NOT_DATED_NOTE]: 'sched.notDatedNote',
  [ALREADY_IN_GROUND_NOTE]: 'sched.alreadyInGroundNote'
};

/** The English seed-start notes in the viewer's language, for API
 *  responses the planting forms show. */
export function localizeSeedStartNotes(notes: readonly string[], locale?: string | null): string[] {
  if (!locale) return [...notes];
  return notes.map((n) => (NOTE_KEYS[n] ? t(locale, NOTE_KEYS[n]) : n));
}

export function seedStartNotes(plan: SeedStartPlan): string[] {
  const notes: string[] = [];
  if (plan.sowAfterTransplant) notes.push(SOW_AFTER_TRANSPLANT_NOTE);
  if (plan.unknown.includes('sow')) {
    notes.push(SOW_UNKNOWN_NOTE);
  }
  if (plan.unknown.includes('harden')) {
    notes.push(HARDEN_UNKNOWN_NOTE);
  }
  return notes;
}

/** Aborts the planting's open seed-start tasks (direct seed or bought
 *  seedlings). Done and skipped rows stay as they are. */
export function abortSeedStartTasks(cropId: string, nowMs: number = Date.now()): number {
  return db
    .update(tasks)
    .set({ abortedAt: new Date(nowMs), abortReason: SEED_START_ABORT_REASON })
    .where(
      withTenant(
        tasks,
        and(
          like(tasks.pluginTemplateKey, `seedstart:${cropId}:%`),
          isNull(tasks.completedAt),
          isNull(tasks.abortedAt)
        )
      )
    )
    .run().changes;
}

/** Whether the planting was ever planned as started indoors: any seed-start
 *  task row exists for it, in any state (E1-1). */
export function hasSeedStartTasks(cropId: string): boolean {
  return (
    db
      .select({ id: tasks.id })
      .from(tasks)
      .where(withTenant(tasks, like(tasks.pluginTemplateKey, `seedstart:${cropId}:%`)))
      .limit(1)
      .get() !== undefined
  );
}

/** Open seed-start tasks of the planting, for the response and tests. */
export function listSeedStartTasks(cropId: string) {
  return db
    .select()
    .from(tasks)
    .where(
      withTenant(
        tasks,
        inArray(
          tasks.id,
          (['sow', 'harden', 'transplant'] as const).map((s) => seedStartTaskId(cropId, s))
        )
      )
    )
    .all();
}

function blockName(blockId: string): string {
  return (
    db
      .select({ name: blocks.name })
      .from(blocks)
      .where(withTenant(blocks, eq(blocks.id, blockId)))
      .get()?.name ?? 'the bed'
  );
}

/** App setting set when the grower answered "bought seedlings" before the
 *  planting had a date, so no task row exists yet to carry the answer
 *  (E1-1 keeps the checkbox itself unstored). */
export function boughtSeedlingsKey(cropId: string): string {
  return `seedstart_bought.${cropId}`;
}

export function isBoughtSeedlings(cropId: string): boolean {
  return getSetting(boughtSeedlingsKey(cropId)) === '1';
}

export interface EstablishmentOutcome {
  establishment: 'direct-seed' | 'transplant' | null;
  /** True when this call wrote (or rewrote) seed-start tasks. */
  startedIndoors: boolean;
  taskIds: string[];
  notes: string[];
}

/**
 * Applies a planting's "Seed or seedling?" answer. Call inside the planting
 * write's transaction, after the planting row exists.
 *
 * - `establishment` is stored when it was sent (`undefined` leaves the
 *   column alone, which keeps today's behavior for unanswered forms).
 * - A dated transplant started indoors (`startIndoors` not false) gets its
 *   seed-start tasks. An undated one gets them when it is scheduled (E1-4a).
 * - Direct seed or bought seedlings abort any open seed-start tasks.
 */
export function applyPlantingEstablishment(
  cropId: string,
  answer: Omit<PlantingEstablishment, 'establishment'> & {
    establishment?: 'direct-seed' | 'transplant' | null;
  },
  plugin: SeedStartPluginSlice | undefined,
  nowMs: number = Date.now()
): EstablishmentOutcome {
  if (answer.establishment !== undefined) setEstablishment(cropId, answer.establishment);
  const crop = getCrop(cropId);
  const establishment = crop?.establishment ?? null;
  const none: EstablishmentOutcome = {
    establishment,
    startedIndoors: false,
    taskIds: [],
    notes: []
  };
  if (!crop) return none;
  if (establishment === 'transplant' && answer.startIndoors === false) {
    setSetting(boughtSeedlingsKey(cropId), '1');
  } else if (answer.startIndoors === true || answer.establishment !== undefined) {
    if (isBoughtSeedlings(cropId)) deleteSetting(boughtSeedlingsKey(cropId));
  }
  if (!plugin) return none;
  if (establishment !== 'transplant' || answer.startIndoors === false) {
    if (answer.establishment !== undefined || answer.startIndoors === false) {
      abortSeedStartTasks(cropId, nowMs);
    }
    return none;
  }
  if (answer.startIndoors === undefined && answer.establishment === undefined) return none;
  if (crop.plantingDate == null) {
    return {
      ...none,
      notes: [NOT_DATED_NOTE]
    };
  }
  if (isAlreadyInGround(crop.plantingDate, nowMs)) {
    abortSeedStartTasks(cropId, nowMs);
    return { ...none, notes: [ALREADY_IN_GROUND_NOTE] };
  }
  const result = materializeSeedStartTasks({
    cropId,
    blockId: crop.blockId,
    cropName: crop.varietyDisplayName,
    bedName: blockName(crop.blockId),
    inGroundMs: crop.plantingDate,
    plugin,
    sowIndoorsOnMs: answer.sowIndoorsOn,
    nowMs
  });
  return { establishment, startedIndoors: true, taskIds: result.taskIds, notes: result.notes };
}

/**
 * E1-4a: a transplant planting that just got its first date. It gets
 * seed-start tasks unless seed-start rows already exist for it in any
 * state, which means the grower already answered with a date on file.
 */
export function seedStartTasksOnFirstDate(
  cropId: string,
  plugin: SeedStartPluginSlice | undefined,
  nowMs: number = Date.now()
): EstablishmentOutcome | null {
  const crop = getCrop(cropId);
  if (!crop || !plugin || crop.establishment !== 'transplant' || crop.plantingDate == null) {
    return null;
  }
  if (hasSeedStartTasks(cropId) || isBoughtSeedlings(cropId)) return null;
  return applyPlantingEstablishment(cropId, { startIndoors: true }, plugin, nowMs);
}

/** After a task is marked done. Closing a Transplant task stamps the
 *  planting's trays that have no transplant date (E1-17); closing a Sow task
 *  answers with the planting so the page can offer "Log the tray" (E1-16).
 *  Call inside the close's transaction. */
export function afterSeedStartTaskDone(
  task: { pluginTemplateKey?: string; cropId?: string | null },
  atMs: number
): { step: 'sow' | 'harden' | 'transplant'; cropId: string } | null {
  const step = seedStartStepOf(task.pluginTemplateKey);
  if (!step || !task.cropId) return null;
  if (step === 'transplant') stampTraysTransplanted(task.cropId, atMs);
  return { step, cropId: task.cropId };
}

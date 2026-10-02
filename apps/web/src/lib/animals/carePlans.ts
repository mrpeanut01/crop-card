/**
 * Phase 32D care plans (D1). Pure and client-safe: the vocabulary, the
 * deterministic task keys, the next-due arithmetic and the wording that
 * lock screens and email may carry. The server (`lib/server/carePlans.ts`)
 * and the pages share it.
 *
 * Dates are calendar days (`YYYY-MM-DD`). A plan's `next_due_at` and its
 * task's `scheduled_for` are stored as UTC midnight of that day, the same
 * convention every other dated task uses (`dueYmd` in `lib/prefs.ts`).
 */

import type { HealthEventKind } from '$lib/safety/animalWithdrawal';
import type { AnimalSubjectType } from './model';
import { t, type MessageKey } from '$lib/i18n';

/** Every care kind (D0-4): the 32A table kinds plus the species plugin's
 *  `shearing` and `health-check`. */
export const CARE_PLAN_KINDS = [
  'vaccination',
  'deworm',
  'treatment',
  'vet-visit',
  'hoof-trim',
  'grooming',
  'shearing',
  'health-check',
  'other'
] as const;
export type CarePlanKind = (typeof CARE_PLAN_KINDS)[number];

/** D0-4: the health event a closed care task writes, or null for husbandry
 *  kinds that close as plain tasks. */
export const CARE_TO_HEALTH_KIND: Record<CarePlanKind, HealthEventKind | null> = {
  vaccination: 'vaccination',
  deworm: 'deworm',
  treatment: 'treatment',
  'vet-visit': 'vet-visit',
  'hoof-trim': null,
  grooming: null,
  shearing: null,
  'health-check': null,
  other: null
};

/** Kinds whose Done must carry the health form (D0-5): a dose goes through
 *  the 32C treatment path and the hold guard, never a quick Done. */
export const HOLD_BEARING_CARE_KINDS: readonly CarePlanKind[] = [
  'vaccination',
  'deworm',
  'treatment'
];

export function isHoldBearingCare(kind: CarePlanKind): boolean {
  return HOLD_BEARING_CARE_KINDS.includes(kind);
}

export const CARE_KIND_LABEL: Record<CarePlanKind, string> = {
  vaccination: 'Vaccine',
  deworm: 'Wormer',
  treatment: 'Treatment',
  'vet-visit': 'Vet visit',
  'hoof-trim': 'Hoof trim',
  grooming: 'Grooming',
  shearing: 'Shearing',
  'health-check': 'Health check',
  other: 'Care'
};

export const CARE_KIND_CHOICES = CARE_PLAN_KINDS.map((value) => ({
  value,
  label: CARE_KIND_LABEL[value]
}));

/** D2-10: how many days ahead a task shows. A reminder setting, not a
 *  health figure; the owner can change it per plan. */
export function defaultLeadDays(kind: CarePlanKind): number {
  return kind === 'vaccination' ? 14 : 3;
}

export const MAX_LEAD_DAYS = 90;

/** D0-2: tasks are written this far ahead, or the plan's lead if longer. */
export const CARE_HORIZON_DAYS = 30;

export function horizonDays(leadDays: number): number {
  return Math.max(leadDays, CARE_HORIZON_DAYS);
}

export const SNOOZE_DAYS = [1, 3, 7] as const;
export type SnoozeDays = (typeof SNOOZE_DAYS)[number];

/** Abort reasons written by the care engine itself. */
export const PLAN_EDITED = 'plan-edited';
export const PLAN_ENDED = 'plan-ended';
export const ENGINE_ABORT_REASONS: readonly string[] = [PLAN_EDITED, PLAN_ENDED];

// ─── Calendar days ──────────────────────────────────────────────────────

const DAY_MS = 86_400_000;
const YMD = /^\d{4}-\d{2}-\d{2}$/;

export function isYmd(v: unknown): v is string {
  return typeof v === 'string' && YMD.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`));
}

export function ymdToMs(ymd: string): number {
  return Date.parse(`${ymd}T00:00:00Z`);
}

export function msToYmd(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

export function addDaysYmd(ymd: string, days: number): string {
  return msToYmd(ymdToMs(ymd) + days * DAY_MS);
}

export function daysBetween(fromYmd: string, toYmd: string): number {
  return Math.round((ymdToMs(toYmd) - ymdToMs(fromYmd)) / DAY_MS);
}

// ─── Task keys (D0-1) ───────────────────────────────────────────────────

/** The task's primary key. `INSERT OR IGNORE` on it is the plan:due dedupe,
 *  and an offline client can derive it. */
export function careTaskId(planId: string, dueOn: string): string {
  return `tk_care_${planId}_${dueOn.replaceAll('-', '')}`;
}

export function careTemplateKey(planId: string, dueOn: string): string {
  return `care:${planId}:${dueOn}`;
}

/** What `tasks.recurrence_json` holds for a care task. */
export interface CareTaskMeta {
  care: 1;
  subjectType: AnimalSubjectType;
  subjectId: string;
  planId: string;
  dueOn: string;
  careKind: CarePlanKind;
  leadDays: number;
}

export function careMetaJson(meta: Omit<CareTaskMeta, 'care'>): string {
  return JSON.stringify({ care: 1, ...meta });
}

export function parseCareMeta(json: string | null | undefined): CareTaskMeta | null {
  if (!json) return null;
  let v: unknown;
  try {
    v = JSON.parse(json);
  } catch {
    return null;
  }
  if (!v || typeof v !== 'object') return null;
  const m = v as Record<string, unknown>;
  if (m.care !== 1) return null;
  if (m.subjectType !== 'animal' && m.subjectType !== 'group') return null;
  if (typeof m.subjectId !== 'string' || typeof m.planId !== 'string') return null;
  if (!isYmd(m.dueOn)) return null;
  if (!(CARE_PLAN_KINDS as readonly string[]).includes(m.careKind as string)) return null;
  const lead = typeof m.leadDays === 'number' && m.leadDays >= 0 ? Math.floor(m.leadDays) : 0;
  return {
    care: 1,
    subjectType: m.subjectType,
    subjectId: m.subjectId,
    planId: m.planId,
    dueOn: m.dueOn,
    careKind: m.careKind as CarePlanKind,
    leadDays: lead
  };
}

/** The day the task starts to show and the first reminder goes out. */
export function surfaceOn(meta: Pick<CareTaskMeta, 'dueOn' | 'leadDays'>): string {
  return addDaysYmd(meta.dueOn, -meta.leadDays);
}

export function isSurfaced(
  meta: Pick<CareTaskMeta, 'dueOn' | 'leadDays'>,
  todayYmd: string
): boolean {
  return todayYmd >= surfaceOn(meta);
}

// ─── Rolling forward (D0-3) ─────────────────────────────────────────────

export interface PlanCadence {
  intervalDays: number | null;
  onceOn: string | null;
}

/** Done rolls from the day it was actually done. A one-off plan ends. */
export function nextDueAfterDone(plan: PlanCadence, doneOn: string): string | null {
  if (!plan.intervalDays) return null;
  return addDaysYmd(doneOn, plan.intervalDays);
}

/** "Skip this one" rolls from the day it was due. */
export function nextDueAfterSkip(plan: PlanCadence, dueOn: string): string | null {
  if (!plan.intervalDays) return null;
  return addDaysYmd(dueOn, plan.intervalDays);
}

/** The next due day from a last dose the owner typed (D2-09). */
export function nextDueFromLast(lastOn: string, intervalDays: number): string {
  return addDaysYmd(lastOn, intervalDays);
}

// ─── Wording ────────────────────────────────────────────────────────────

/** The task title shown in the app. */
export function careTaskTitle(planTitle: string, subjectName: string): string {
  return `${planTitle}: ${subjectName}`;
}

/** Lock-screen and email text (D0-16): the animal or group and the care
 *  kind only, never a product name or hold detail. */
export function careAlertText(
  kind: CarePlanKind,
  subjectName: string,
  when: 'soon' | 'due',
  daysAway: number
): { title: string; body: string } {
  const label = CARE_KIND_LABEL[kind];
  if (when === 'due') {
    return {
      title: `${label} due today: ${subjectName}`,
      body: `${label} for ${subjectName} is due today. Open CropCard to mark it done.`
    };
  }
  const inDays = daysAway === 1 ? 'tomorrow' : `in ${daysAway} days`;
  return {
    title: `${label} coming up: ${subjectName}`,
    body: `${label} for ${subjectName} is due ${inDays}.`
  };
}

/** Several reminders batched into one push. */
export function careAlertBatchText(items: { kind: CarePlanKind; subjectName: string }[]): {
  title: string;
  body: string;
} {
  const names = [...new Set(items.map((i) => i.subjectName))];
  const shown = names.slice(0, 3).join(', ');
  const more = names.length > 3 ? ` and ${names.length - 3} more` : '';
  return {
    title: `${items.length} animal care jobs coming up`,
    body: `Care is due soon for ${shown}${more}.`
  };
}

/** D2-09: an undated plan never invents a date. */
export function undatedPrompt(title: string, subjectName: string): string {
  return `When was ${subjectName}'s last ${title.toLowerCase()}?`;
}

// ─── Group roll-up (D2-11) ──────────────────────────────────────────────

export interface RollupInput {
  taskId: string;
  meta: CareTaskMeta;
  /** The group an animal subject belongs to, if any. */
  memberOfGroupId: string | null;
}

export interface CareRollup<T extends RollupInput> {
  key: string;
  groupId: string | null;
  careKind: CarePlanKind;
  dueOn: string;
  items: T[];
}

/** Same-kind, same-day tasks for members of one group become one card. */
export function rollupCareTasks<T extends RollupInput>(tasks: readonly T[]): CareRollup<T>[] {
  const out = new Map<string, CareRollup<T>>();
  for (const t of tasks) {
    const groupId = t.meta.subjectType === 'animal' ? t.memberOfGroupId : null;
    const key = groupId ? `g:${groupId}:${t.meta.careKind}:${t.meta.dueOn}` : `t:${t.taskId}`;
    const hit = out.get(key);
    if (hit) hit.items.push(t);
    else
      out.set(key, {
        key,
        groupId,
        careKind: t.meta.careKind,
        dueOn: t.meta.dueOn,
        items: [t]
      });
  }
  return [...out.values()].sort((a, b) =>
    a.dueOn === b.dueOn ? a.key.localeCompare(b.key) : a.dueOn.localeCompare(b.dueOn)
  );
}

// ─── Views shared by /today and the animal pages ────────────────────────

export interface CareItemView {
  taskId: string;
  subjectType: AnimalSubjectType;
  subjectId: string;
  subjectName: string;
  planId: string;
  planTitle: string;
  dueOn: string;
  scheduledOn: string;
  careKind: CarePlanKind;
  intervalDays: number | null;
  productPluginId: string | null;
  foodProducing: boolean;
  status: 'late' | 'due' | 'soon';
}

export interface CareCardView {
  key: string;
  careKind: CarePlanKind;
  dueOn: string;
  groupId: string | null;
  groupName: string | null;
  title: string;
  items: CareItemView[];
}

export function careItemStatus(scheduledOn: string, todayYmd: string): CareItemView['status'] {
  if (scheduledOn < todayYmd) return 'late';
  return scheduledOn === todayYmd ? 'due' : 'soon';
}

/** A roll-up's heading: "Wormer for 14 animals in Herd A". */
export function careCardTitle(
  kind: CarePlanKind,
  items: readonly Pick<CareItemView, 'planTitle' | 'subjectName'>[],
  groupName: string | null,
  locale?: string | null
): string {
  if (items.length === 1) return careTaskTitle(items[0].planTitle, items[0].subjectName);
  if (!locale) {
    return `${CARE_KIND_LABEL[kind]} for ${items.length} animals${groupName ? ` in ${groupName}` : ''}`;
  }
  const label = t(locale, `animals.careKind.${kind}` as MessageKey);
  return groupName
    ? t(locale, 'care.cardTitleIn', { kind: label, count: items.length, group: groupName })
    : t(locale, 'care.cardTitle', { kind: label, count: items.length });
}

/** A plan as the animal pages show it. */
export interface CarePlanView {
  id: string;
  kind: CarePlanKind;
  title: string;
  intervalDays: number | null;
  onceOn: string | null;
  nextDueOn: string | null;
  leadDays: number;
  active: boolean;
  provenance: 'plugin' | 'manual' | 'fallback';
  /** The species suggestion's note ("Ask your vet."), if any. */
  note: string | null;
}

const DEFAULT_TITLE_KEYS: Record<string, MessageKey> = {
  'Rabies vaccine': 'animallib.careDefault.rabies',
  'Core vaccines': 'animallib.careDefault.coreVaccines'
};

const DEFAULT_NOTE_KEYS: Record<string, MessageKey> = {
  'How often depends on the vaccine and local law. Ask your vet.':
    'animallib.careDefault.rabiesNote',
  'Which ones and how often depend on age and risk. Ask your vet.':
    'animallib.careDefault.coreVaccinesNote'
};

/** A care plan title for display. The built-in dog and cat defaults (seeded
 *  with plugin provenance) read in `locale`; owner-typed titles as stored. */
export function carePlanTitleIn(
  plan: { title: string; provenance?: string | null },
  locale?: string | null
): string {
  if (!locale || plan.provenance !== 'plugin') return plan.title;
  const key = DEFAULT_TITLE_KEYS[plan.title];
  return key ? t(locale, key) : plan.title;
}

/** A built-in species care note in `locale`; anything else as is. */
export function careNoteIn(note: string | null | undefined, locale?: string | null): string {
  if (!note) return '';
  const key = locale ? DEFAULT_NOTE_KEYS[note] : undefined;
  return key ? t(locale, key) : note;
}

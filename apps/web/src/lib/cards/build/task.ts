import { DEFAULT_PREFS, formatInstant } from '$lib/prefs';
import { labelForTaskCategory, type TaskCategory } from '$lib/plan/taskCategory';
import {
  TASK_STATUS_LABEL,
  TASK_STATUS_TONE,
  deriveTaskStatus,
  statusWithQueued,
  type QueuedTaskAction,
  type TaskStatus
} from '$lib/tasks/status';
import {
  PLANTING_CARE_LINK_LABEL,
  cardHref,
  cardKey,
  plantingCardHref,
  type CardFact,
  type CardModel,
  type CardProvenance,
  type CardSection
} from '../model';
import type { FarmSnapshot } from '../snapshot';
import {
  blockDisplayName,
  resolveOptions,
  type BuildOptions,
  type ResolvedOptions
} from './common';

export interface TaskCardInput {
  id: string;
  title: string;
  body?: string | null;
  kind?: 'primary' | 'pre-task' | 'post-task';
  category?: TaskCategory | null;
  scheduledFor: number;
  completedAt?: number | null;
  abortedAt?: number | null;
  abortReason?: string | null;
  blockId?: string | null;
  cropId?: string | null;
  pluginTemplateKey?: string | null;
}

export interface TaskCardContext {
  /** "Cherokee Purple tomato · Bed 3", already resolved by the caller. */
  where?: string | null;
  equipmentLabel?: string | null;
  /** Linked prep and follow-up titles, listed on screen and print. */
  before?: string[];
  after?: string[];
  /** A Done or Skip that is waiting in the offline queue. */
  queued?: QueuedTaskAction | null;
  /** Epoch ms of the data the card was built from. */
  asOf: number;
  /** Where the title opens. Defaults to the offline card page. */
  href?: string;
}

const KIND_KICKER: Record<NonNullable<TaskCardInput['kind']>, string> = {
  primary: 'Task',
  'pre-task': 'Get ready',
  'post-task': 'Follow-up'
};

function whenText(task: TaskCardInput, status: TaskStatus, opts: ResolvedOptions): string {
  const day = formatInstant(task.scheduledFor, opts.prefs, 'month-day', { weekday: 'short' });
  switch (status) {
    case 'late':
      return `Was due ${day}`;
    case 'due-today':
      return 'Today';
    case 'done':
      return task.completedAt
        ? `Done ${formatInstant(task.completedAt, opts.prefs, 'month-day')}`
        : 'Done';
    case 'skipped':
      return task.abortedAt
        ? `Skipped ${formatInstant(task.abortedAt, opts.prefs, 'month-day')}`
        : 'Skipped';
    default:
      return day;
  }
}

function provenanceFor(task: TaskCardInput): CardProvenance {
  const key = task.pluginTemplateKey ?? '';
  if (/^(crop|equipment|derived):/.test(key)) return { source: 'plugin', detail: 'crop calendar' };
  return { source: 'data', detail: 'your task list' };
}

export function taskStatusFor(
  task: TaskCardInput,
  queued: QueuedTaskAction | null | undefined,
  opts: ResolvedOptions
): TaskStatus {
  return statusWithQueued(deriveTaskStatus(task, opts.now, opts.prefs.timeZone), queued ?? null);
}

export function buildTaskCardFrom(
  task: TaskCardInput,
  ctx: TaskCardContext,
  opts: ResolvedOptions
): CardModel {
  const status = taskStatusFor(task, ctx.queued, opts);
  const kicker = [
    KIND_KICKER[task.kind ?? 'primary'],
    task.category && task.category !== 'other' ? labelForTaskCategory(task.category) : null
  ]
    .filter(Boolean)
    .join(' · ');

  const facts: CardFact[] = [{ label: 'When', value: whenText(task, status, opts) }];
  if (ctx.where) facts.push({ label: 'Where', value: ctx.where, provenance: 'data' });
  if (ctx.equipmentLabel) facts.push({ label: 'Equipment', value: ctx.equipmentLabel });
  if (status === 'skipped' && task.abortReason?.trim())
    facts.push({ label: 'Why skipped', value: task.abortReason.trim(), provenance: 'manual' });

  const sections: CardSection[] = [];
  if (task.body?.trim()) sections.push({ title: 'Notes', items: [task.body.trim()] });
  if (ctx.before?.length) sections.push({ title: 'Get ready', items: ctx.before });
  if (ctx.after?.length) sections.push({ title: 'Follow-up', items: ctx.after });

  const key = cardKey('task', task.id);
  return {
    kind: 'task',
    key,
    kicker,
    title: task.title,
    facts,
    sections,
    asOf: ctx.asOf,
    provenance: [provenanceFor(task)],
    href: ctx.href ?? cardHref('task', key),
    status: { id: status, label: TASK_STATUS_LABEL[status], tone: TASK_STATUS_TONE[status] },
    ...(task.cropId
      ? { links: [{ label: PLANTING_CARE_LINK_LABEL, href: plantingCardHref(task.cropId) }] }
      : {})
  };
}

export function buildTaskCard(
  task: TaskCardInput,
  ctx: TaskCardContext,
  options: BuildOptions & { now: number }
): CardModel {
  return buildTaskCardFrom(task, ctx, {
    prefs: options.prefs ?? DEFAULT_PREFS,
    now: options.now
  });
}

/** An open task from the offline snapshot, for `/cards/task/tk_<id>`. */
export function buildTaskCardFromSnapshot(
  snapshot: FarmSnapshot,
  id: string,
  options: BuildOptions = {}
): CardModel | null {
  const task = snapshot.tasks.find((t) => t.id === id);
  if (!task) return null;
  const opts = resolveOptions(snapshot, options);
  const planting = task.cropId ? snapshot.plantings.find((p) => p.id === task.cropId) : undefined;
  const blockId = task.blockId ?? planting?.blockId ?? null;
  const block = blockId ? snapshot.blocks.find((b) => b.id === blockId) : undefined;
  const where = [planting?.varietyDisplayName, block && blockDisplayName(block)]
    .filter(Boolean)
    .join(' · ');
  const equipment = task.equipmentId
    ? snapshot.equipment.find((e) => e.id === task.equipmentId)
    : undefined;
  return buildTaskCardFrom(
    {
      id: task.id,
      title: task.title,
      category: task.category,
      scheduledFor: task.scheduledFor,
      blockId,
      cropId: planting?.id ?? null
    },
    { where: where || null, equipmentLabel: equipment?.label ?? null, asOf: snapshot.generatedAt },
    opts
  );
}

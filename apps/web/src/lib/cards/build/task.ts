import { formatDueDay, formatInstant } from '$lib/prefs';
import { labelForTaskCategory, type TaskCategory } from '$lib/plan/taskCategory';
import {
  TASK_STATUS_TONE,
  deriveTaskStatus,
  statusWithQueued,
  type QueuedTaskAction,
  type TaskStatus
} from '$lib/tasks/status';
import {
  cardHref,
  cardKey,
  plantingCardHref,
  plantingCareLinkLabel,
  type CardFact,
  type CardModel,
  type CardProvenance,
  type CardSection
} from '../model';
import type { FarmSnapshot } from '../snapshot';
import {
  blockDisplayName,
  resolveOptions,
  resolvedFrom,
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
  /** The assignee's name through `memberName`, when the task has one. */
  assignee?: string | null;
}

const KIND_KICKER = {
  primary: 'cards.task.kind.primary',
  'pre-task': 'cards.task.kind.pre',
  'post-task': 'cards.task.kind.post'
} as const satisfies Record<NonNullable<TaskCardInput['kind']>, string>;

function whenText(task: TaskCardInput, status: TaskStatus, opts: ResolvedOptions): string {
  const { tr } = opts;
  const day = formatDueDay(task.scheduledFor, opts.prefs, 'month-day', { weekday: 'short' });
  switch (status) {
    case 'late':
      return tr('cards.task.wasDue', { day });
    case 'due-today':
      return tr('cards.task.today');
    case 'done':
      return task.completedAt
        ? tr('cards.task.doneOn', {
            date: formatInstant(task.completedAt, opts.prefs, 'month-day')
          })
        : tr('cards.task.done');
    case 'skipped':
      return task.abortedAt
        ? tr('cards.task.skippedOn', {
            date: formatInstant(task.abortedAt, opts.prefs, 'month-day')
          })
        : tr('cards.task.skipped');
    default:
      return day;
  }
}

function provenanceFor(task: TaskCardInput, opts: ResolvedOptions): CardProvenance {
  const key = task.pluginTemplateKey ?? '';
  if (/^(crop|equipment|derived):/.test(key))
    return { source: 'plugin', detail: opts.tr('cards.prov.cropCalendar') };
  return { source: 'data', detail: opts.tr('cards.prov.taskList') };
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
  const { tr } = opts;
  const status = taskStatusFor(task, ctx.queued, opts);
  const kicker = [
    tr(KIND_KICKER[task.kind ?? 'primary']),
    task.category && task.category !== 'other'
      ? labelForTaskCategory(task.category, opts.prefs.locale)
      : null
  ]
    .filter(Boolean)
    .join(' · ');

  const facts: CardFact[] = [{ label: tr('cards.task.when'), value: whenText(task, status, opts) }];
  if (ctx.where) facts.push({ label: tr('cards.task.where'), value: ctx.where, provenance: 'data' });
  if (ctx.equipmentLabel) facts.push({ label: tr('cards.task.equipment'), value: ctx.equipmentLabel });
  if (ctx.assignee?.trim())
    facts.push({ label: tr('cards.task.assignedTo'), value: ctx.assignee.trim() });
  if (status === 'skipped' && task.abortReason?.trim())
    facts.push({
      label: tr('cards.task.whySkipped'),
      value: task.abortReason.trim(),
      provenance: 'manual'
    });

  const sections: CardSection[] = [];
  if (task.body?.trim()) sections.push({ title: tr('cards.notes'), items: [task.body.trim()] });
  if (ctx.before?.length) sections.push({ title: tr('cards.task.kind.pre'), items: ctx.before });
  if (ctx.after?.length) sections.push({ title: tr('cards.task.kind.post'), items: ctx.after });

  const key = cardKey('task', task.id);
  return {
    kind: 'task',
    key,
    kicker,
    title: task.title,
    facts,
    sections,
    asOf: ctx.asOf,
    provenance: [provenanceFor(task, opts)],
    href: ctx.href ?? cardHref('task', key),
    status: { id: status, label: tr(`tasks.status.${status}`), tone: TASK_STATUS_TONE[status] },
    ...(task.cropId
      ? {
          links: [
            {
              label: plantingCareLinkLabel(opts.prefs.locale),
              href: plantingCardHref(task.cropId)
            }
          ]
        }
      : {})
  };
}

export function buildTaskCard(
  task: TaskCardInput,
  ctx: TaskCardContext,
  options: BuildOptions & { now: number }
): CardModel {
  return buildTaskCardFrom(task, ctx, resolvedFrom(options.prefs, options.now, options.locale));
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
  const where = [planting?.varietyDisplayName, block && blockDisplayName(block, opts.prefs.locale)]
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
    {
      where: where || null,
      equipmentLabel: equipment?.label ?? null,
      asOf: snapshot.generatedAt,
      assignee: snapshotAssigneeName(snapshot, task.assigneeUserId)
    },
    opts
  );
}

/** The name of a snapshot task's assignee (F1-11). Absent or unknown ids
 *  read as unassigned. */
export function snapshotAssigneeName(
  snapshot: Pick<FarmSnapshot, 'people'>,
  assigneeUserId: string | null | undefined
): string | null {
  if (!assigneeUserId) return null;
  return snapshot.people?.find((p) => p.id === assigneeUserId)?.name ?? null;
}

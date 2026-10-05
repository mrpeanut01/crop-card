/**
 * GET  /api/tasks?from=&to=&cropId=&blockId=&equipmentId=&status=&kind=&limit=
 * POST /api/tasks  — create a task (kind=primary or pre/post w/ linkedToTaskId)
 *
 * Sprint E + Phase 12 — central task surface for /today's tab loaders and
 * the future /crops dashboard. Inspector role read-only enforced at the
 * hooks layer; helper + owner can create.
 *
 * Creating a primary task that names a `cropPluginId` and/or `equipmentId`
 * runs `materializePluginPrePost` to auto-attach matching plugin templates.
 * The newly created task IDs are returned so the UI can scroll to them.
 *
 * Phase 32F (F1-2): an owner may give the task to a farm member with
 * `assigneeUserId`; its prep and follow-up tasks go to the same person.
 * Anyone else sending a person gets 403 "Ask the owner.".
 *
 * Phase 34A (SO-02, SO-04): replayable from the offline queue through the
 * client record id header, with the whole create in one transaction. A
 * scheduled suggestion (`pluginTemplateKey` starting `derived:`) the farm
 * already has answers 200 with that task and `alreadyScheduled: true`.
 */

import { json, type RequestHandler } from '@sveltejs/kit';
import { getBlock } from '$lib/db/blocks';
import { getCrop } from '$lib/db/crops';
import { getEquipment } from '$lib/db/equipment';
import {
  assignTask,
  createTask,
  findTaskByTemplateKey,
  getTask,
  listTasks,
  loadEquipmentContext,
  materializePluginPrePost
} from '$lib/db/tasks';
import { ensureSystemUser } from '$lib/db/users';
import { currentUser } from '$lib/server/auth';
import { canMutate } from '$lib/server/session';
import { getRegistry } from '$lib/server/registry';
import { assignRefusal, canAssignTasks, rejectUnassignable } from '$lib/server/taskAssign';
import { taskCreateSchema } from '$lib/tasks/apiSchemas';
import { withClientRecordId } from '$lib/server/clientRecordId';
import { writeRecord } from '$lib/server/recordWrite';
import type { CropPlugin } from '$lib/plugins/schemas';
import { t } from '$lib/i18n';

/** Template keys /today mints for a scheduled calendar suggestion. */
const SUGGESTION_KEY_PREFIX = 'derived:';
const NOTHING_MATERIALIZED: { preTaskIds: string[]; postTaskIds: string[] } = {
  preTaskIds: [],
  postTaskIds: []
};

export const _requestSchema = taskCreateSchema;

export const GET: RequestHandler = ({ url }) => {
  const fromMs = Number(url.searchParams.get('from')) || undefined;
  const toMs = Number(url.searchParams.get('to')) || undefined;
  const cropId = url.searchParams.get('cropId') ?? undefined;
  const blockId = url.searchParams.get('blockId') ?? undefined;
  const equipmentId = url.searchParams.get('equipmentId') ?? undefined;
  const status = url.searchParams.get('status') as 'open' | 'completed' | 'aborted' | null;
  const kind = url.searchParams.get('kind') as 'primary' | 'pre-task' | 'post-task' | null;
  const limit = Math.min(Number(url.searchParams.get('limit') ?? 200), 1000);

  const tasks = listTasks({
    fromMs,
    toMs,
    cropId,
    blockId,
    equipmentId,
    status: status ?? undefined,
    kind: kind ?? undefined,
    limit
  });
  return json({ tasks });
};

export const POST: RequestHandler = withClientRecordId(async (event) => {
  const auth = currentUser(event);
  if (auth && !canMutate(auth.role)) {
    return json(
      { error: t(event.locals?.locale, 'stockui.api.inspectorReadOnly') },
      { status: 403 }
    );
  }

  let body: unknown;
  try {
    body = await event.request.json();
  } catch {
    return json(
      { error: t(event.locals?.locale, 'stockui.api.invalidJsonShort') },
      { status: 400 }
    );
  }
  const parsed = taskCreateSchema.safeParse(body);
  if (!parsed.success) {
    return json(
      {
        error: t(event.locals?.locale, 'stockui.api.invalidRequest'),
        issues: parsed.error.issues.map((i) => ({
          path: i.path.join('.'),
          message: i.message
        }))
      },
      { status: 400 }
    );
  }

  // Referenced rows must belong to the active Owner (Invariant 6): the
  // tenant-scoped getters return undefined for another Owner's ids.
  const d = parsed.data;
  const foreign =
    (d.blockId && !getBlock(d.blockId) && 'blockId') ||
    (d.cropId && !getCrop(d.cropId) && 'cropId') ||
    (d.equipmentId && !getEquipment(d.equipmentId) && 'equipmentId') ||
    (d.linkedToTaskId && !getTask(d.linkedToTaskId) && 'linkedToTaskId');
  if (foreign) {
    return json(
      { error: t(event.locals?.locale, 'api.errB.unknownField', { name: foreign }) },
      { status: 400 }
    );
  }

  const assigneeUserId = d.assigneeUserId ?? null;
  if (assigneeUserId) {
    if (!canAssignTasks(auth)) return assignRefusal(event.locals?.locale);
    const refused = rejectUnassignable(assigneeUserId, event.locals?.locale);
    if (refused) return refused;
  }

  const performer = auth ?? (await ensureSystemUser());

  // Resolved before the transaction, which must stay synchronous.
  let cropPlugin: CropPlugin | undefined;
  let equipmentCtx: ReturnType<typeof loadEquipmentContext> = {
    template: undefined,
    lastUsedAt: undefined
  };
  if (d.kind === 'primary') {
    const registry = await getRegistry();
    const crop = d.cropId ? getCrop(d.cropId) : undefined;
    const r = crop ? registry.get(crop.cropPluginId) : undefined;
    cropPlugin = r?.plugin.type === 'crop' ? r.plugin : undefined;
    if (d.equipmentId) equipmentCtx = loadEquipmentContext(d.equipmentId);
  }

  const { assigneeUserId: _assignee, ...fields } = d;
  const dedupeKey = d.pluginTemplateKey?.startsWith(SUGGESTION_KEY_PREFIX)
    ? d.pluginTemplateKey
    : null;

  // SO-02/SO-04: the create, its plugin prep and follow-up tasks and the
  // assignment commit together with the replay receipt. A scheduled
  // suggestion whose key the farm already has writes nothing.
  const out = writeRecord(event, () => {
    const existing = dedupeKey ? findTaskByTemplateKey(dedupeKey) : undefined;
    if (existing) return { task: existing, materialized: NOTHING_MATERIALIZED, already: true };

    const created = createTask({ ...fields, createdById: performer.id });
    const materialized =
      d.kind === 'primary'
        ? materializePluginPrePost({
            primaryTaskId: created.id,
            scheduledFor: d.scheduledFor,
            cropPlugin,
            equipmentTemplate: equipmentCtx.template,
            equipmentLastUsedAt: equipmentCtx.lastUsedAt
          })
        : NOTHING_MATERIALIZED;
    const task = assigneeUserId ? (assignTask(created.id, assigneeUserId) ?? created) : created;
    return { task, materialized, already: false };
  });

  if (out.already) {
    return json(
      { task: out.task, materialized: out.materialized, alreadyScheduled: true },
      { status: 200 }
    );
  }
  return json({ task: out.task, materialized: out.materialized }, { status: 201 });
});

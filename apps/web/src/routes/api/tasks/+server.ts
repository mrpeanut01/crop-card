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
 */

import { json, type RequestHandler } from '@sveltejs/kit';
import { getBlock } from '$lib/db/blocks';
import { getCrop } from '$lib/db/crops';
import { getEquipment } from '$lib/db/equipment';
import {
  assignTask,
  createTask,
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

export const POST: RequestHandler = async (event) => {
  const auth = currentUser(event);
  if (auth && !canMutate(auth.role)) {
    return json({ error: 'inspector role is read-only' }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await event.request.json();
  } catch {
    return json({ error: 'invalid JSON' }, { status: 400 });
  }
  const parsed = taskCreateSchema.safeParse(body);
  if (!parsed.success) {
    return json(
      {
        error: 'invalid request',
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
    return json({ error: `unknown ${foreign}` }, { status: 400 });
  }

  const assigneeUserId = d.assigneeUserId ?? null;
  if (assigneeUserId) {
    if (!canAssignTasks(auth)) return assignRefusal();
    const refused = rejectUnassignable(assigneeUserId);
    if (refused) return refused;
  }

  const performer = auth ?? (await ensureSystemUser());
  const { assigneeUserId: _assignee, ...fields } = d;
  const created = createTask({
    ...fields,
    createdById: performer.id
  });

  // For primary tasks, auto-attach plugin pre/post templates.
  let materialized: { preTaskIds: string[]; postTaskIds: string[] } = {
    preTaskIds: [],
    postTaskIds: []
  };
  if (parsed.data.kind === 'primary') {
    const registry = await getRegistry();
    const crop = parsed.data.cropId ? getCrop(parsed.data.cropId) : undefined;
    const cropPlugin = crop
      ? (() => {
          const r = registry.get(crop.cropPluginId);
          return r?.plugin.type === 'crop' ? r.plugin : undefined;
        })()
      : undefined;
    const equipmentCtx = parsed.data.equipmentId
      ? loadEquipmentContext(parsed.data.equipmentId)
      : { template: undefined, lastUsedAt: undefined };

    materialized = materializePluginPrePost({
      primaryTaskId: created.id,
      scheduledFor: parsed.data.scheduledFor,
      cropPlugin,
      equipmentTemplate: equipmentCtx.template,
      equipmentLastUsedAt: equipmentCtx.lastUsedAt
    });
  }

  const task = assigneeUserId ? (assignTask(created.id, assigneeUserId) ?? created) : created;
  return json({ task, materialized }, { status: 201 });
};

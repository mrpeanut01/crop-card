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
 */

import { json, type RequestHandler } from '@sveltejs/kit';
import { z } from 'zod';
import { getCrop } from '$lib/db/crops';
import {
  createTask,
  listTasks,
  loadEquipmentContext,
  materializePluginPrePost
} from '$lib/db/tasks';
import { ensureSystemUser } from '$lib/db/users';
import { currentUser } from '$lib/server/auth';
import { canMutate } from '$lib/server/session';
import { getRegistry } from '$lib/server/registry';

const inputSchema = z
  .object({
    title: z.string().min(1).max(120),
    body: z.string().max(500).optional(),
    kind: z.enum(['primary', 'pre-task', 'post-task']),
    linkedToTaskId: z.string().optional(),
    cropId: z.string().optional(),
    blockId: z.string().optional(),
    equipmentId: z.string().optional(),
    scheduledFor: z.number().int(),
    pluginTemplateKey: z.string().optional()
  })
  .refine((v) => v.kind === 'primary' || !!v.linkedToTaskId, {
    message: 'pre-task / post-task requires linkedToTaskId'
  });

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
  const parsed = inputSchema.safeParse(body);
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

  const performer = auth ?? (await ensureSystemUser());
  const created = createTask({
    ...parsed.data,
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

  return json({ task: created, materialized }, { status: 201 });
};

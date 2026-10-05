/**
 * POST /api/tasks/:id/pre-from-plugin
 *
 * Materializes plugin pre-task templates onto an existing primary task.
 * Idempotent on `pluginTemplateKey` so re-running this endpoint after the
 * operator already attached templates is safe (returns no new IDs).
 *
 * Used by /today's "Suggest pre-tasks from plugin" affordance after the
 * operator decides which equipment / crop applies.
 */

import { error, json, type RequestHandler } from '@sveltejs/kit';
import { getCrop } from '$lib/db/crops';
import { getTask, loadEquipmentContext, materializePluginPrePost } from '$lib/db/tasks';
import { currentUser } from '$lib/server/auth';
import { canMutate } from '$lib/server/session';
import { getRegistry } from '$lib/server/registry';
import { t } from '$lib/i18n';

export const POST: RequestHandler = async (event) => {
  const auth = currentUser(event);
  if (auth && !canMutate(auth.role)) {
    return json(
      { error: t(event.locals?.locale, 'stockui.api.inspectorReadOnly') },
      { status: 403 }
    );
  }
  if (!event.params.id) throw error(400, t(event.locals?.locale, 'stockui.api.idRequired'));
  const primary = getTask(event.params.id);
  if (!primary) throw error(404, t(event.locals?.locale, 'api.errB.taskNotFound'));
  if (primary.kind !== 'primary') {
    return json({ error: t(event.locals?.locale, 'api.errB.preTasksPrimary') }, { status: 400 });
  }

  const registry = await getRegistry();
  const crop = primary.cropId ? getCrop(primary.cropId) : undefined;
  const cropPlugin = crop
    ? (() => {
        const r = registry.get(crop.cropPluginId);
        return r?.plugin.type === 'crop' ? r.plugin : undefined;
      })()
    : undefined;
  const equipmentCtx = primary.equipmentId
    ? loadEquipmentContext(primary.equipmentId)
    : { template: undefined, lastUsedAt: undefined };

  const result = materializePluginPrePost({
    primaryTaskId: primary.id,
    scheduledFor: primary.scheduledFor,
    cropPlugin,
    equipmentTemplate: equipmentCtx.template,
    equipmentLastUsedAt: equipmentCtx.lastUsedAt
  });
  return json(result);
};

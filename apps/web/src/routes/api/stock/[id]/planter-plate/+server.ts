import { error, json, type RequestHandler } from '@sveltejs/kit';
import { getStockItem, updateStockItem } from '$lib/db/stock';
import { requireOwner } from '$lib/server/auth';
import { t } from '$lib/i18n';

/**
 * POST /api/stock/[id]/planter-plate
 *
 * Persists a chosen plate configuration into stockItems.metadataJson under
 * the `planterPlateConfig` key. Used by both the per-seed flow (modal
 * "Override" affordance) and the generic /tools/planter-plate-selector
 * route's "Save to seed lot" dropdown.
 *
 * Owner-only (helpers cannot edit seed records). Tenant scoping is
 * handled by the repo via withTenant/tenantValues.
 */
export const POST: RequestHandler = async (event) => {
  requireOwner(event);
  const id = event.params.id;
  if (!id) throw error(400, t(event.locals?.locale, 'stockui.api.idRequired'));
  const item = getStockItem(id);
  if (!item) throw error(404, t(event.locals?.locale, 'api.errB.unknownStockItemId', { id }));
  if (item.category !== 'seed') throw error(400, t(event.locals?.locale, 'api.errB.itemNotSeed'));

  let body: { planterPlateConfig?: Record<string, unknown> } | null;
  try {
    body = (await event.request.json()) as typeof body;
  } catch {
    throw error(400, t(event.locals?.locale, 'stockui.api.invalidJsonShort'));
  }
  if (!body?.planterPlateConfig || typeof body.planterPlateConfig !== 'object') {
    throw error(400, t(event.locals?.locale, 'api.errB.plateConfigRequired'));
  }
  if (
    !('plateNumber' in body.planterPlateConfig) ||
    typeof body.planterPlateConfig.plateNumber !== 'string'
  ) {
    throw error(400, t(event.locals?.locale, 'api.errB.plateNumberRequired'));
  }

  let existing: Record<string, unknown> = {};
  if (item.metadataJson) {
    try {
      const parsed = JSON.parse(item.metadataJson);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        existing = parsed as Record<string, unknown>;
      }
    } catch {
      existing = {};
    }
  }
  const merged = {
    ...existing,
    planterPlateConfig: {
      ...body.planterPlateConfig,
      source: 'manual' as const,
      savedAt: new Date().toISOString()
    }
  };
  updateStockItem(id, { metadataJson: JSON.stringify(merged) });
  return json({ ok: true, planterPlateConfig: merged.planterPlateConfig });
};

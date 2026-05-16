/**
 * POST /api/stock/[id]/refresh-ai/apply
 *
 * Applies a subset of fields from the stored pending AI Refresh suggestion
 * to the stock item, then clears the pending column. Powers the Settings
 * → Pending Suggestions popup so the operator can accept/reject per field
 * without opening the full /stock edit modal.
 *
 * Body: { acceptedKeys: string[] }
 *
 * Merge rules mirror what InventoryView's applyRefreshSelection +
 * saveEdit do on the client:
 *   - Seed-meta fields (daysToMaturity, plantingTempMinF, spacingInches,
 *     depthInches, sunRequirement, seedsPerPacket, matureHeightFt) merge
 *     into metadataJson.
 *   - activeIngredients replaces activeIngredientsJson.
 *   - npk / formulationType / productClass merge into formulationJson.
 */

import { json, type RequestHandler } from '@sveltejs/kit';
import { z } from 'zod';
import { getStockItem, setPendingRefresh, updateStockItem, type UpdateItemInput } from '$lib/db/stock';
import { requireOwner } from '$lib/server/auth';

const bodySchema = z.object({
  acceptedKeys: z.array(z.string().min(1)).max(20)
});

const SEED_KEYS = new Set([
  'daysToMaturity',
  'plantingTempMinF',
  'spacingInches',
  'depthInches',
  'sunRequirement',
  'seedsPerPacket',
  'matureHeightFt',
  // Planter-plate suggestion (Phase 41 follow-up). All three keys merge
  // into stock_items.metadata_json alongside the existing seed fields.
  'seedDimensionsMm',
  'seedShape',
  'planterPlateConfig'
]);
const FORMULATION_KEYS = new Set(['npk', 'formulationType', 'productClass']);

export const POST: RequestHandler = async (event) => {
  requireOwner(event);
  const id = event.params.id;
  if (!id) return json({ error: 'missing id' }, { status: 400 });
  const item = getStockItem(id);
  if (!item) return json({ error: 'item not found' }, { status: 404 });
  if (!item.pendingRefreshJson) {
    return json({ error: 'no pending refresh on this item' }, { status: 409 });
  }

  let raw: unknown;
  try {
    raw = await event.request.json();
  } catch {
    return json({ error: 'invalid JSON body' }, { status: 400 });
  }
  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) {
    return json({ error: 'invalid request', issues: parsed.error.issues }, { status: 400 });
  }
  const acceptedKeys = new Set(parsed.data.acceptedKeys);
  if (acceptedKeys.size === 0) {
    // Operator unchecked everything — discarding is the right semantic.
    setPendingRefresh(id, null);
    return json({ ok: true, applied: 0 });
  }

  let pending: Record<string, unknown>;
  try {
    pending = JSON.parse(item.pendingRefreshJson) as Record<string, unknown>;
  } catch {
    return json({ error: 'pending refresh JSON corrupted' }, { status: 500 });
  }

  const existingSeedMeta = safeParseObject(item.metadataJson) ?? {};
  const existingFormulation = safeParseObject(item.formulationJson) ?? {};
  let seedMetaTouched = false;
  let formulationTouched = false;
  let activeIngredientsValue: unknown = null;
  const applied: string[] = [];

  for (const key of acceptedKeys) {
    const field = pending[key];
    const value = unwrap(field);
    if (value === undefined) continue;

    if (SEED_KEYS.has(key)) {
      existingSeedMeta[key] = value;
      seedMetaTouched = true;
      applied.push(key);
    } else if (key === 'activeIngredients' && Array.isArray(value)) {
      activeIngredientsValue = value;
      applied.push(key);
    } else if (FORMULATION_KEYS.has(key)) {
      existingFormulation[key === 'formulationType' ? 'type' : key] = value;
      formulationTouched = true;
      applied.push(key);
    }
  }

  const updates: UpdateItemInput = {};
  if (seedMetaTouched) updates.metadataJson = JSON.stringify(existingSeedMeta);
  if (formulationTouched) updates.formulationJson = JSON.stringify(existingFormulation);
  if (activeIngredientsValue !== null) {
    updates.activeIngredientsJson = JSON.stringify(activeIngredientsValue);
  }

  if (Object.keys(updates).length > 0) {
    updateStockItem(id, updates);
  }
  setPendingRefresh(id, null);

  return json({ ok: true, applied: applied.length, appliedKeys: applied });
};

function safeParseObject(raw: string | undefined): Record<string, unknown> | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw);
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function unwrap(field: unknown): unknown {
  if (field === null || field === undefined) return undefined;
  if (typeof field === 'object' && !Array.isArray(field) && 'value' in (field as Record<string, unknown>)) {
    return (field as { value: unknown }).value;
  }
  return field;
}

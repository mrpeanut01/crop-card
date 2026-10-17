/**
 * GET /api/equipment/:id/water-targets: the Areas and beds an automatic
 * waterer covers. Every member can read.
 *
 * PUT /api/equipment/:id/water-targets: replace them (Phase 37E, R-21).
 * Owner only; every id is checked to be this farm's. A bed inside an Area
 * that is covered whole is dropped.
 */

import { json, type RequestHandler } from '@sveltejs/kit';
import { getBlock } from '$lib/db/blocks';
import { getEquipment } from '$lib/db/equipment';
import { listWaterTargets, replaceWaterTargets } from '$lib/db/waterers';
import { t } from '$lib/i18n';
import { waterTargetsSchema } from '$lib/irrigation/apiSchemas';
import { requireOwner, requireUser } from '$lib/server/auth';
import { assertBlock, assertField, rejectForeignRefsIn } from '$lib/server/foreignRefs';
import { invalid, readJson } from '$lib/server/irrigationApi';

export const _requestSchema = waterTargetsSchema;

export const GET: RequestHandler = (event) => {
  requireUser(event);
  const equipment = event.params.id ? getEquipment(event.params.id) : undefined;
  if (!equipment)
    return json({ error: t(event.locals?.locale, 'stockui.api.notFound') }, { status: 404 });
  return json({ targets: listWaterTargets([equipment.id]) });
};

export const PUT: RequestHandler = async (event) => {
  requireOwner(event);
  const locale = event.locals?.locale;
  const equipment = event.params.id ? getEquipment(event.params.id) : undefined;
  if (!equipment) return json({ error: t(locale, 'stockui.api.notFound') }, { status: 404 });
  if (equipment.type !== 'irrigation') {
    return json({ error: t(locale, 'herbse.api.scheduleIrrigationOnly') }, { status: 400 });
  }
  const read = await readJson(event.request);
  if (!read.ok) return json({ error: t(locale, 'stockui.api.invalidJson') }, { status: 400 });
  const parsed = waterTargetsSchema.safeParse(read.body);
  if (!parsed.success) return invalid(parsed.error);
  const { areaIds, blockIds } = parsed.data;

  const foreign = rejectForeignRefsIn(
    locale,
    ...areaIds.map((id, i) => assertField(`areaIds.${i}`, id)),
    ...blockIds.map((id, i) => assertBlock(`blockIds.${i}`, id))
  );
  if (foreign) return foreign;

  const rows: Array<{ fieldId: string; blockId: string | null }> = areaIds.map((fieldId) => ({
    fieldId,
    blockId: null
  }));
  for (const blockId of blockIds) {
    const fieldId = getBlock(blockId)?.fieldId ?? null;
    if (!fieldId) {
      return json({ error: t(locale, 'herbse.api.bedNoArea') }, { status: 400 });
    }
    rows.push({ fieldId, blockId });
  }
  return json({ targets: replaceWaterTargets(equipment.id, rows) });
};

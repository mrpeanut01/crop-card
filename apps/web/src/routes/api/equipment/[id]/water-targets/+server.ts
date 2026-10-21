/**
 * GET /api/equipment/:id/water-targets: the Areas and beds an automatic
 * waterer covers. Every member can read.
 *
 * PUT /api/equipment/:id/water-targets: replace them (Phase 37E, R-21).
 * Owner only; every id is checked to be this farm's. A bed inside an Area
 * that is covered whole is dropped. The owner may type each target's share
 * of the gallons (#870, FU870-1): all or none, totalling 100; without them
 * the gallons split by size.
 */

import { json, type RequestHandler } from '@sveltejs/kit';
import { getBlock } from '$lib/db/blocks';
import { getEquipment } from '$lib/db/equipment';
import {
  listWaterTargets,
  normalizeTargets,
  replaceWaterTargets,
  type TargetInput
} from '$lib/db/waterers';
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
  const { areaIds, blockIds, areaShares, blockShares } = parsed.data;

  const foreign = rejectForeignRefsIn(
    locale,
    ...areaIds.map((id, i) => assertField(`areaIds.${i}`, id)),
    ...blockIds.map((id, i) => assertBlock(`blockIds.${i}`, id))
  );
  if (foreign) return foreign;

  const rows: TargetInput[] = areaIds.map((fieldId) => ({
    fieldId,
    blockId: null,
    sharePct: areaShares?.[fieldId] ?? null
  }));
  for (const blockId of blockIds) {
    const fieldId = getBlock(blockId)?.fieldId ?? null;
    if (!fieldId) {
      return json({ error: t(locale, 'herbse.api.bedNoArea') }, { status: 400 });
    }
    rows.push({ fieldId, blockId, sharePct: blockShares?.[blockId] ?? null });
  }
  const shares = checkShares(normalizeTargets(rows));
  if (shares !== 'ok') {
    return json(
      {
        error: t(
          locale,
          shares === 'SHARES_INCOMPLETE' ? 'herbsg.api.sharesIncomplete' : 'herbsg.api.sharesTotal'
        ),
        code: shares
      },
      { status: 400 }
    );
  }
  return json({ targets: replaceWaterTargets(equipment.id, rows) });
};

/** Typed shares (FU870-1) are all or none over the targets that are kept,
 *  and total 100. One target needs none; its share is dropped on save. */
function checkShares(kept: readonly TargetInput[]): 'ok' | 'SHARES_INCOMPLETE' | 'SHARES_TOTAL' {
  if (kept.length < 2) return 'ok';
  const typed = kept.filter((r) => r.sharePct !== null && r.sharePct !== undefined);
  if (typed.length === 0) return 'ok';
  if (typed.length !== kept.length) return 'SHARES_INCOMPLETE';
  const total = typed.reduce((sum, r) => sum + (r.sharePct ?? 0), 0);
  return total === 100 ? 'ok' : 'SHARES_TOTAL';
}

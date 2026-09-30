/**
 * GET /api/irrigation/summary?fieldId=: what the watering and gauge sheets
 * need for one Area: its beds, the weekly target, recent logs and gauge
 * readings, and every garden or field Area with its latest reading so one
 * gauge reading can count for several. Every member can read it.
 */

import { json, type RequestHandler } from '@sveltejs/kit';
import { listBlocks } from '$lib/db/blocks';
import { getField, listFields } from '$lib/db/fields';
import { listIrrigationEvents, listRainGaugeReadings } from '$lib/db/irrigation';
import { getSetting } from '$lib/db/settings';
import { requireUser } from '$lib/server/auth';
import { canRemoveLog } from '$lib/server/irrigationApi';
import { resolveTarget, sqFtOf } from '$lib/server/waterAdvice.server';
import { GAUGE_LOOKBACK_MS } from '$lib/weather/waterBalance';
import { WATER_TARGET_SOURCE, waterTargetKey } from '$lib/weather/waterSources';

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

function hasSize(row: {
  acres?: number | null;
  widthFt?: number | null;
  lengthFt?: number | null;
  geometryGeojson?: string | null;
}): boolean {
  return (
    sqFtOf({
      acres: row.acres ?? null,
      widthFt: row.widthFt ?? null,
      lengthFt: row.lengthFt ?? null,
      geometryGeojson: row.geometryGeojson ?? null
    }) !== null
  );
}

export const GET: RequestHandler = (event) => {
  const user = requireUser(event);
  const fieldId = event.url.searchParams.get('fieldId') ?? '';
  const field = getField(fieldId);
  if (!field) return json({ error: 'No such Area' }, { status: 404 });
  const now = Date.now();

  const areas = listFields({ kinds: ['garden', 'field'] });
  const areaIds = areas.map((a) => a.id);
  const recentGauges = listRainGaugeReadings({
    fieldIds: areaIds.includes(fieldId) ? areaIds : [...areaIds, fieldId],
    fromMs: now - GAUGE_LOOKBACK_MS
  });
  const lastGaugeAt = (id: string) => recentGauges.find((g) => g.fieldId === id)?.readAt ?? null;

  const gauges = listRainGaugeReadings({ fieldIds: [fieldId], limit: 10 }).map((g) => ({
    id: g.id,
    readAt: g.readAt,
    inches: g.inches,
    canRemove: canRemoveLog(user, g.recordedById)
  }));
  const logs = listIrrigationEvents({ fieldIds: [fieldId], fromMs: now - WEEK_MS, limit: 20 }).map(
    (l) => ({
      id: l.id,
      blockId: l.blockId,
      occurredAt: l.occurredAt,
      inches: l.inches,
      gallons: l.gallons,
      durationMin: l.durationMin,
      method: l.method,
      canRemove: canRemoveLog(user, l.performedById)
    })
  );
  const target = resolveTarget(getSetting(waterTargetKey(fieldId)));

  return json({
    area: { id: field.id, name: field.name, kind: field.kind, sized: hasSize(field) },
    beds: listBlocks({ plantings: 'none' })
      .filter((b) => b.fieldId === fieldId)
      .map((b) => ({ id: b.id, name: b.blockLabel ?? b.name, sized: hasSize(b) })),
    target,
    targetSource: target?.provenance === 'fallback' ? WATER_TARGET_SOURCE : null,
    canSetTarget: user.role === 'owner',
    canLog: user.role !== 'inspector',
    lastGaugeAt: lastGaugeAt(fieldId),
    areas: areas.map((a) => ({ id: a.id, name: a.name, lastGaugeAt: lastGaugeAt(a.id) })),
    gauges,
    logs
  });
};

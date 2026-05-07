/**
 * GET /api/spray/records/export.csv
 *
 * Streams a CSV of the full spray-record set for compliance retention
 * (FR-09, NFR-05). Columns: id, occurredAt, blockId, sprayerId, products,
 * chemistry classes, conditions, rules version, plugin hashes, locked.
 */

import { type RequestHandler } from '@sveltejs/kit';
import papa from 'papaparse';
import { evaluateLock, listSprayEvents } from '$lib/db/sprayEvents';

export const GET: RequestHandler = ({ url }) => {
  const sprayerId = url.searchParams.get('sprayerId') ?? undefined;
  const blockId = url.searchParams.get('blockId') ?? undefined;
  const events = listSprayEvents({ limit: 10_000, sprayerId, blockId });

  const rows = events.map((e) => ({
    id: e.id,
    occurredAtIso: new Date(e.occurredAt).toISOString(),
    blockId: e.blockId,
    sprayerId: e.sprayerId,
    performedById: e.performedById,
    products: e.products.map((p) => p.pluginId).join('|'),
    chemistryClasses: Array.from(
      new Set(e.products.flatMap((p) => p.chemistryClasses))
    ).join('|'),
    windMph: e.conditions.windMph,
    tempF: e.conditions.tempF,
    rainForecastMmNext24h: e.conditions.rainForecastMmNext24h,
    rulesVersion: e.rulesVersion,
    pluginHashes: Object.entries(e.pluginHashes)
      .map(([id, h]) => `${id}:${h.slice(0, 16)}`)
      .join('|'),
    customRateOverride: e.customRateOverride ? 'true' : 'false',
    locked: evaluateLock(e) ? 'true' : 'false'
  }));

  const csv = papa.unparse(rows, { header: true });
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');

  return new Response(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="cropcard-spray-records-${stamp}.csv"`
    }
  });
};

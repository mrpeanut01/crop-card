/**
 * GET /api/spray/records/export.usda.csv
 *
 * USDA / NRCS-flavored spray-record export (Phase 10). Layout follows the
 * NRCS Pesticide Application Records template that EQIP / CSP audits ask
 * for. EPA-reg is mandatory for cost-share eligibility — rows missing it
 * still render, but with a `WARNING` column flagged so the operator can
 * fix the underlying plugin before submitting.
 *
 * Columns:
 *   date_iso, block_label, applicator, product_name, epa_reg_no,
 *   active_ingredients, rate_per_acre, rate_unit, total_amount,
 *   total_unit, area_acres, target_pest, weather_wind_mph, weather_temp_f,
 *   warning
 */

import { type RequestHandler } from '@sveltejs/kit';
import papa from 'papaparse';
import { listBlocks } from '$lib/db/blocks';
import { listInsecticideEvents } from '$lib/db/insecticideEvents';
import { listSprayEvents } from '$lib/db/sprayEvents';
import { getRegistry } from '$lib/server/registry';

export const GET: RequestHandler = async ({ url }) => {
  const blockId = url.searchParams.get('blockId') ?? undefined;
  const fromMs = Number(url.searchParams.get('from')) || undefined;
  const toMs = Number(url.searchParams.get('to')) || undefined;

  const sprays = listSprayEvents({ blockId, fromMs, toMs, limit: 10_000 });
  const insecticides = listInsecticideEvents({ blockId, fromMs, toMs, limit: 10_000 });
  const blocks = new Map(listBlocks().map((b) => [b.id, b]));
  const registry = await getRegistry();

  type Row = {
    date_iso: string;
    block_label: string;
    applicator: string;
    product_name: string;
    epa_reg_no: string;
    active_ingredients: string;
    rate_per_acre: string;
    rate_unit: string;
    area_acres: string;
    target_pest: string;
    weather_wind_mph: string;
    weather_temp_f: string;
    warning: string;
  };
  const rows: Row[] = [];

  function rowsForSprayEvent(e: (typeof sprays)[number]) {
    const block = blocks.get(e.blockId);
    const acres = block?.acres ?? '';
    const wind = e.conditions.windMph;
    const temp = e.conditions.tempF;
    for (const p of e.products) {
      const plugin = registry.get(p.pluginId)?.plugin;
      const epa =
        plugin && (plugin.type === 'herbicide' || plugin.type === 'insecticide')
          ? (plugin.epaRegistrationNumber ?? '')
          : '';
      rows.push({
        date_iso: new Date(e.occurredAt).toISOString().slice(0, 10),
        block_label: block?.blockLabel ?? block?.name ?? e.blockId,
        applicator: e.performedById,
        product_name: plugin && 'displayName' in plugin ? plugin.displayName : p.pluginId,
        epa_reg_no: epa,
        active_ingredients: p.chemistryClasses.join(' / '),
        rate_per_acre: p.rate?.amount?.toString() ?? '',
        rate_unit: p.rate?.unit ?? '',
        area_acres: acres ? String(acres) : '',
        target_pest: '',
        weather_wind_mph: String(wind),
        weather_temp_f: String(temp),
        warning: epa ? '' : 'MISSING_EPA_REG'
      });
    }
  }

  function rowsForInsecticideEvent(e: (typeof insecticides)[number]) {
    const block = blocks.get(e.blockId);
    const acres = block?.acres ?? '';
    const wind = e.conditions.windMph;
    const temp = e.conditions.tempF;
    for (const p of e.products) {
      const plugin = registry.get(p.pluginId)?.plugin;
      const epa =
        plugin && plugin.type === 'insecticide' ? (plugin.epaRegistrationNumber ?? '') : '';
      rows.push({
        date_iso: new Date(e.occurredAt).toISOString().slice(0, 10),
        block_label: block?.blockLabel ?? block?.name ?? e.blockId,
        applicator: e.performedById,
        product_name: p.displayName,
        epa_reg_no: epa,
        active_ingredients: p.iracGroups.map((g) => `IRAC ${g}`).join(' / '),
        rate_per_acre: p.rate?.amount?.toString() ?? '',
        rate_unit: p.rate?.unit ?? '',
        area_acres: acres ? String(acres) : '',
        target_pest: e.scoutObservation?.pest ?? '',
        weather_wind_mph: String(wind),
        weather_temp_f: String(temp),
        warning: epa ? '' : 'MISSING_EPA_REG'
      });
    }
  }

  for (const e of sprays) rowsForSprayEvent(e);
  for (const e of insecticides) rowsForInsecticideEvent(e);

  // NRCS template wants chronological order.
  rows.sort((a, b) => a.date_iso.localeCompare(b.date_iso));

  const csv = papa.unparse(rows, { header: true });
  const stamp = new Date().toISOString().slice(0, 10);

  return new Response(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="cropcard-usda-pesticide-records-${stamp}.csv"`
    }
  });
};

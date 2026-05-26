/**
 * GET /api/spray/records/export.usda.csv
 *
 * USDA / NRCS-flavored spray-record export (Phase 10). Layout follows the
 * NRCS Pesticide Application Records template that EQIP / CSP audits ask
 * for. EPA-reg is mandatory for cost-share eligibility — rows missing it
 * still render, but with a `WARNING` column flagged so the operator can
 * fix the underlying plugin before submitting.
 *
 * Sprint 2 (#204):
 *   - `applicator` resolves to the human-readable email (or display name)
 *     instead of the internal user UUID.
 *   - `target_pest` falls back to the plugin's first target weed/pest
 *     when no scout observation accompanies the row.
 *   - EPA reg # is also pulled for fungicides (previously only herbicide
 *     + insecticide branches set it).
 *
 * Columns:
 *   date_iso, block_label, applicator, product_name, epa_reg_no,
 *   active_ingredients, rate_per_acre, rate_unit, area_acres,
 *   target_pest, weather_wind_mph, weather_temp_f, warning
 */

import { type RequestHandler } from '@sveltejs/kit';
import { inArray } from 'drizzle-orm';
import papa from 'papaparse';
import { listBlocks } from '$lib/db/blocks';
import { listInsecticideEvents } from '$lib/db/insecticideEvents';
import { listSprayEvents } from '$lib/db/sprayEvents';
import { listFungicideEvents } from '$lib/db/fungicideEvents';
import { getRegistry } from '$lib/server/registry';
import { requireUser } from '$lib/server/auth';
import { APP_VERSION } from '$lib/version';
import { db } from '$lib/db/client';
import { users } from '$lib/db/schema';
import { unscopedQueryNote } from '$lib/db/tenant';

function applicatorMap(userIds: string[]): Map<string, string> {
  const ids = Array.from(new Set(userIds.filter(Boolean)));
  if (ids.length === 0) return new Map();
  unscopedQueryNote('USDA CSV resolves applicator email from the global users table');
  const rows = db
    .select({ id: users.id, email: users.email })
    .from(users)
    .where(inArray(users.id, ids))
    .all();
  return new Map(rows.map((r) => [r.id, r.email]));
}

function targetPestFor(
  plugin: { type?: string; targetPests?: string[]; targetDiseases?: string[] } | undefined
): string {
  if (!plugin) return '';
  if (plugin.type === 'insecticide' && plugin.targetPests && plugin.targetPests.length > 0) {
    return plugin.targetPests.slice(0, 3).join('; ');
  }
  if (plugin.type === 'fungicide' && plugin.targetDiseases && plugin.targetDiseases.length > 0) {
    return plugin.targetDiseases.slice(0, 3).join('; ');
  }
  // Herbicides have no standalone targetWeeds list in the schema; the
  // NRCS form treats the column as optional for non-bug applications.
  return '';
}

export const GET: RequestHandler = async (event) => {
  const user = requireUser(event);
  const { url } = event;
  const blockId = url.searchParams.get('blockId') ?? undefined;
  const fromMs = Number(url.searchParams.get('from')) || undefined;
  const toMs = Number(url.searchParams.get('to')) || undefined;

  const sprays = listSprayEvents({ blockId, fromMs, toMs, limit: 10_000 });
  const insecticides = listInsecticideEvents({ blockId, fromMs, toMs, limit: 10_000 });
  const fungicides = listFungicideEvents({ blockId, fromMs, toMs, limit: 10_000 });
  const blocks = new Map(listBlocks().map((b) => [b.id, b]));
  const registry = await getRegistry();

  const applicatorIds = [
    ...sprays.map((e) => e.performedById),
    ...insecticides.map((e) => e.performedById),
    ...fungicides.map((e) => e.performedById)
  ];
  const applicators = applicatorMap(applicatorIds);

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

  function applicatorLabel(userId: string): string {
    return applicators.get(userId) ?? userId;
  }

  function rowsForSprayEvent(e: (typeof sprays)[number]) {
    const block = blocks.get(e.blockId);
    const acres = block?.acres ?? '';
    const wind = e.conditions.windMph;
    const temp = e.conditions.tempF;
    for (const p of e.products) {
      const plugin = registry.get(p.pluginId)?.plugin as
        | { type?: string; displayName?: string; epaRegistrationNumber?: string }
        | undefined;
      const epa =
        plugin && (plugin.type === 'herbicide' || plugin.type === 'insecticide')
          ? (plugin.epaRegistrationNumber ?? '')
          : '';
      rows.push({
        date_iso: new Date(e.occurredAt).toISOString().slice(0, 10),
        block_label: block?.blockLabel ?? block?.name ?? e.blockId,
        applicator: applicatorLabel(e.performedById),
        product_name: plugin?.displayName ?? p.pluginId,
        epa_reg_no: epa,
        active_ingredients: p.chemistryClasses.join(' / '),
        rate_per_acre: p.rate?.amount?.toString() ?? '',
        rate_unit: p.rate?.unit ?? '',
        area_acres: acres ? String(acres) : '',
        target_pest: targetPestFor(plugin),
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
      const plugin = registry.get(p.pluginId)?.plugin as
        | { type?: string; epaRegistrationNumber?: string; targetPests?: string[] }
        | undefined;
      const epa =
        plugin && plugin.type === 'insecticide' ? (plugin.epaRegistrationNumber ?? '') : '';
      rows.push({
        date_iso: new Date(e.occurredAt).toISOString().slice(0, 10),
        block_label: block?.blockLabel ?? block?.name ?? e.blockId,
        applicator: applicatorLabel(e.performedById),
        product_name: p.displayName,
        epa_reg_no: epa,
        // targetPestFor handles the targetPests / targetDiseases lookup;
        // here we keep IRAC mode-of-action codes as the active-ingredient
        // breakdown that USDA reviewers expect.
        active_ingredients: p.iracGroups.map((g) => `IRAC ${g}`).join(' / '),
        rate_per_acre: p.rate?.amount?.toString() ?? '',
        rate_unit: p.rate?.unit ?? '',
        area_acres: acres ? String(acres) : '',
        target_pest: e.scoutObservation?.pest ?? targetPestFor(plugin),
        weather_wind_mph: String(wind),
        weather_temp_f: String(temp),
        warning: epa ? '' : 'MISSING_EPA_REG'
      });
    }
  }

  function rowsForFungicideEvent(e: (typeof fungicides)[number]) {
    const block = blocks.get(e.blockId);
    const acres = block?.acres ?? '';
    const wind = e.conditions.windMph;
    const temp = e.conditions.tempF;
    for (const p of e.products) {
      const plugin = registry.get(p.pluginId)?.plugin as
        | { type?: string; epaRegistrationNumber?: string; targetPests?: string[] }
        | undefined;
      const epa = plugin && plugin.type === 'fungicide' ? (plugin.epaRegistrationNumber ?? '') : '';
      rows.push({
        date_iso: new Date(e.occurredAt).toISOString().slice(0, 10),
        block_label: block?.blockLabel ?? block?.name ?? e.blockId,
        applicator: applicatorLabel(e.performedById),
        product_name: p.displayName,
        epa_reg_no: epa,
        active_ingredients: p.fracCodes.map((g) => `FRAC ${g}`).join(' / '),
        rate_per_acre: p.rate?.amount?.toString() ?? '',
        rate_unit: p.rate?.unit ?? '',
        area_acres: acres ? String(acres) : '',
        target_pest: e.diseaseObservation?.disease ?? targetPestFor(plugin),
        weather_wind_mph: String(wind),
        weather_temp_f: String(temp),
        warning: epa ? '' : 'MISSING_EPA_REG'
      });
    }
  }

  for (const e of sprays) rowsForSprayEvent(e);
  for (const e of insecticides) rowsForInsecticideEvent(e);
  for (const e of fungicides) rowsForFungicideEvent(e);

  rows.sort((a, b) => a.date_iso.localeCompare(b.date_iso));

  const csvBody = papa.unparse(rows, { header: true });
  const generatedAt = new Date().toISOString();
  const signatureLine = `# Generated by CropCard v${APP_VERSION} on ${generatedAt} · exported by ${user.email}`;
  const csv = `${csvBody}\n${signatureLine}\n`;
  const stamp = generatedAt.slice(0, 10);

  return new Response(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="cropcard-usda-pesticide-records-${stamp}.csv"`,
      'X-CropCard-Generator': `CropCard/${APP_VERSION}`,
      'X-CropCard-Exported-By': user.email
    }
  });
};

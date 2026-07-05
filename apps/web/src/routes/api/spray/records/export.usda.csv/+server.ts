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
 * #326 (inspector-grade completeness — UC-22 receiver acceptance):
 *   The original 13 columns keep their exact names + positions; the 5 new
 *   columns are appended so existing importers stay compatible.
 *   - `crop_commodity` names the crop/commodity treated (resolved from the
 *     block's plantings), which NRCS reviewers require per application.
 *   - `applicator_cert_no` is present but empty — CropCard does not yet
 *     capture the applicator's pesticide-applicator certification number
 *     (documented data-gap, see PR). The column is emitted so downstream
 *     tooling has a stable slot and the operator can hand-annotate.
 *   - `total_amount_applied` = rate_per_acre × area_acres (blank when
 *     either input is missing) — the absolute product volume/mass, not
 *     just the per-acre rate.
 *   - `moisture_pct` carries stored moisture on harvest rows (UC-16); the
 *     `record_kind` column discriminates `application` from `harvest` so
 *     the one CSV carries both application + harvest-moisture records.
 *
 * Columns:
 *   date_iso, block_label, applicator, product_name, epa_reg_no,
 *   active_ingredients, rate_per_acre, rate_unit, area_acres,
 *   target_pest, weather_wind_mph, weather_temp_f, warning,
 *   crop_commodity, applicator_cert_no, total_amount_applied, moisture_pct,
 *   record_kind
 */

import { type RequestHandler } from '@sveltejs/kit';
import { inArray } from 'drizzle-orm';
import papa from 'papaparse';
import { listBlocks } from '$lib/db/blocks';
import type { BlockWithPlantings } from '$lib/db/blocks';
import { listInsecticideEvents } from '$lib/db/insecticideEvents';
import { listSprayEvents } from '$lib/db/sprayEvents';
import { listFungicideEvents } from '$lib/db/fungicideEvents';
import { listHarvestEvents } from '$lib/db/harvestEvents';
import { getRegistry } from '$lib/server/registry';
import { requireUser } from '$lib/server/auth';
import { parseExportDateRange } from '$lib/exports/dateRange';
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
  const sprayerId = url.searchParams.get('sprayerId') ?? undefined;
  const { fromMs, toMs } = parseExportDateRange(url.searchParams);

  const sprays = listSprayEvents({ blockId, sprayerId, fromMs, toMs, limit: 10_000 });
  const insecticides = listInsecticideEvents({ blockId, fromMs, toMs, limit: 10_000 });
  const fungicides = listFungicideEvents({ blockId, fromMs, toMs, limit: 10_000 });
  const harvests = listHarvestEvents({ blockId, fromMs, toMs });
  const blocks = new Map(listBlocks().map((b) => [b.id, b]));
  const registry = await getRegistry();

  // Crop/commodity treated — the block's plantings name the crop under the
  // application. Multiple plantings on one block join with "; ". Resolved
  // to the registry displayName when available, else the plugin id.
  function cropCommodityFor(block: BlockWithPlantings | undefined): string {
    if (!block || block.plantings.length === 0) return '';
    const names = new Set<string>();
    for (const p of block.plantings) {
      const plugin = registry.get(p.cropPluginId)?.plugin as { displayName?: string } | undefined;
      names.add(plugin?.displayName ?? p.varietyDisplayName ?? p.cropPluginId);
    }
    return Array.from(names).slice(0, 3).join('; ');
  }

  // total_amount_applied = rate/acre × acres. Blank when either is missing
  // so the inspector can tell "not computable" from a real zero.
  function totalAmountApplied(rate: number | undefined, acres: number | undefined): string {
    if (rate === undefined || acres === undefined || !Number.isFinite(rate)) return '';
    const total = rate * acres;
    return Number.isFinite(total) ? String(Math.round(total * 1000) / 1000) : '';
  }

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
    // #326 appended columns (kept after the stable 13 above).
    crop_commodity: string;
    applicator_cert_no: string;
    total_amount_applied: string;
    moisture_pct: string;
    record_kind: string;
  };
  const rows: Row[] = [];

  // Data-gap (#326): no applicator pesticide-certification number is
  // captured anywhere in the schema yet. Emit the column empty rather than
  // fabricate a value; the PR documents this so it can be backfilled once
  // the field exists on the user/owner profile.
  const APPLICATOR_CERT_NO = '';

  function applicatorLabel(userId: string): string {
    return applicators.get(userId) ?? userId;
  }

  function rowsForSprayEvent(e: (typeof sprays)[number]) {
    const block = blocks.get(e.blockId);
    const acres = block?.acres;
    const commodity = cropCommodityFor(block);
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
        area_acres: acres !== undefined ? String(acres) : '',
        target_pest: targetPestFor(plugin),
        weather_wind_mph: String(wind),
        weather_temp_f: String(temp),
        warning: epa ? '' : 'MISSING_EPA_REG',
        crop_commodity: commodity,
        applicator_cert_no: APPLICATOR_CERT_NO,
        total_amount_applied: totalAmountApplied(p.rate?.amount, acres),
        moisture_pct: '',
        record_kind: 'application'
      });
    }
  }

  function rowsForInsecticideEvent(e: (typeof insecticides)[number]) {
    const block = blocks.get(e.blockId);
    const acres = block?.acres;
    const commodity = cropCommodityFor(block);
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
        area_acres: acres !== undefined ? String(acres) : '',
        target_pest: e.scoutObservation?.pest ?? targetPestFor(plugin),
        weather_wind_mph: String(wind),
        weather_temp_f: String(temp),
        warning: epa ? '' : 'MISSING_EPA_REG',
        crop_commodity: commodity,
        applicator_cert_no: APPLICATOR_CERT_NO,
        total_amount_applied: totalAmountApplied(p.rate?.amount, acres),
        moisture_pct: '',
        record_kind: 'application'
      });
    }
  }

  function rowsForFungicideEvent(e: (typeof fungicides)[number]) {
    const block = blocks.get(e.blockId);
    const acres = block?.acres;
    const commodity = cropCommodityFor(block);
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
        area_acres: acres !== undefined ? String(acres) : '',
        target_pest: e.diseaseObservation?.disease ?? targetPestFor(plugin),
        weather_wind_mph: String(wind),
        weather_temp_f: String(temp),
        warning: epa ? '' : 'MISSING_EPA_REG',
        crop_commodity: commodity,
        applicator_cert_no: APPLICATOR_CERT_NO,
        total_amount_applied: totalAmountApplied(p.rate?.amount, acres),
        moisture_pct: '',
        record_kind: 'application'
      });
    }
  }

  // Harvest rows carry the crop/commodity + stored moisture (UC-16) that an
  // inspector cross-references against the pesticide pre-harvest intervals.
  // These rows leave the application columns blank and set record_kind to
  // 'harvest' so a reviewer can filter them apart.
  function rowsForHarvestEvent(e: (typeof harvests)[number]) {
    const block = blocks.get(e.blockId);
    const plugin = registry.get(e.cropPluginId)?.plugin as { displayName?: string } | undefined;
    rows.push({
      date_iso: new Date(e.occurredAt).toISOString().slice(0, 10),
      block_label: block?.blockLabel ?? block?.name ?? e.blockId,
      applicator: '',
      product_name: '',
      epa_reg_no: '',
      active_ingredients: '',
      rate_per_acre: '',
      rate_unit: '',
      area_acres: block?.acres !== undefined ? String(block.acres) : '',
      target_pest: '',
      weather_wind_mph: '',
      weather_temp_f: '',
      warning: '',
      crop_commodity: plugin?.displayName ?? e.cropPluginId,
      applicator_cert_no: '',
      total_amount_applied: e.quantity ?? '',
      moisture_pct: e.moisturePct !== undefined ? String(e.moisturePct) : '',
      record_kind: 'harvest'
    });
  }

  for (const e of sprays) rowsForSprayEvent(e);
  for (const e of insecticides) rowsForInsecticideEvent(e);
  for (const e of fungicides) rowsForFungicideEvent(e);
  for (const e of harvests) rowsForHarvestEvent(e);

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

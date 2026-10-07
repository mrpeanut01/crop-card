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
 *   - `target_pest` is what the operator recorded (the scout or disease
 *     observation); blank otherwise, never the label's target list (#760).
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
 * #130 — four pollinator-gate columns appended after `record_kind`:
 *   `bloom_status` (in-bloom | not-in-bloom | unknown), `bloom_status_source`
 *   (operator | plugin | default), `attested_no_foragers` (yes | no), and
 *   `pollinator_verdict` (pass | warn | block). Populated on insecticide
 *   rows only; blank on other kinds and on pre-#130 insecticide rows.
 *
 * Columns:
 *   date_iso, block_label, applicator, product_name, epa_reg_no,
 *   active_ingredients, rate_per_acre, rate_unit, area_acres,
 *   target_pest, weather_wind_mph, weather_temp_f, warning,
 *   crop_commodity, applicator_cert_no, total_amount_applied, moisture_pct,
 *   record_kind, bloom_status, bloom_status_source, attested_no_foragers,
 *   pollinator_verdict, recorded_late, days_after_date, mode_of_action,
 *   total_amount_unit, harvest_quantity, rei_hours
 *
 * #760: `active_ingredients` names the label's active ingredients; the
 * mode-of-action groups move to an appended `mode_of_action` column
 * ("IRAC 3A", "FRAC 3"). `total_amount_applied` is a bare number in the
 * appended `total_amount_unit`; a harvest's quantity text goes in the
 * appended `harvest_quantity`. `rei_hours` is the record's restricted-entry
 * interval, blank when not on file (herbicide plugins carry none).
 *
 * Phase 32G (G2-07, G2-08): hay cuttings are `record_kind = hay` rows (mow
 * date, block, performer, crop, bale moisture). `recorded_late` is yes, no,
 * or blank when the kind does not track it; `days_after_date` is the whole
 * days between the record's date and its server save time when late.
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
import { localDay, zoneCaption } from '$lib/exports/localTime';
import { prefsFor } from '$lib/db/userProfile';
import {
  EMPTY_POLLINATOR_CELLS,
  pollinatorAttestationCells,
  type PollinatorAttestationCells
} from '$lib/records/pollinatorAttestation';
import { APP_VERSION } from '$lib/version';
import { db } from '$lib/db/client';
import { users } from '$lib/db/schema';
import { unscopedQueryNote } from '$lib/db/tenant';
import { identityLabel } from '$lib/identity';
import { listHayForExport, type HayExportRow } from '$lib/records/hayExport.server';
import { lateCells, UNTRACKED_LATE_CELLS, type LateCells } from '$lib/records/lateLabel';
import {
  activeIngredientNames,
  cropTreated,
  modeOfActionLabels,
  recordedTarget,
  reiHoursFor
} from '$lib/records/exportFacts';

function applicatorMap(userIds: string[]): Map<string, string> {
  const ids = Array.from(new Set(userIds.filter(Boolean)));
  if (ids.length === 0) return new Map();
  unscopedQueryNote('USDA CSV resolves applicator email from the global users table');
  const rows = db
    .select({ id: users.id, email: users.email, phone: users.phone })
    .from(users)
    .where(inArray(users.id, ids))
    .all();
  return new Map(rows.map((r) => [r.id, identityLabel(r)]));
}

export const GET: RequestHandler = async (event) => {
  const user = requireUser(event);
  const prefs = prefsFor(user.id);
  const { url } = event;
  const blockId = url.searchParams.get('blockId') ?? undefined;
  const sprayerId = url.searchParams.get('sprayerId') ?? undefined;
  const { fromMs, toMs } = parseExportDateRange(url.searchParams, prefs);

  const sprays = listSprayEvents({ blockId, sprayerId, fromMs, toMs });
  // A sprayer filter keeps only that sprayer's applications: harvest and
  // hay rows have no sprayer, so they are left out (as in export.csv).
  const onSprayer = (e: { sprayerId?: string | null }) => !sprayerId || e.sprayerId === sprayerId;
  const insecticides = listInsecticideEvents({ blockId, fromMs, toMs }).filter(onSprayer);
  const fungicides = listFungicideEvents({ blockId, fromMs, toMs }).filter(onSprayer);
  const harvests = sprayerId ? [] : listHarvestEvents({ blockId, fromMs, toMs });
  const hay = sprayerId ? [] : listHayForExport({ blockId, fromMs, toMs });
  const blocks = new Map(listBlocks().map((b) => [b.id, b]));
  const registry = await getRegistry();

  // Crop/commodity treated: the record's planting when it names one on the
  // block, else the block's plantings joined with "; ".
  function cropCommodityFor(block: BlockWithPlantings | undefined, cropId?: string): string {
    if (!block) return '';
    return cropTreated(
      cropId,
      block.plantings,
      (id) => (registry.get(id)?.plugin as { displayName?: string } | undefined)?.displayName
    );
  }

  function totalAmountUnit(rate: { unit: string } | undefined, total: string): string {
    return total && rate ? rate.unit.split('/')[0] : '';
  }

  function reiCell(
    e: { occurredAt: number; reEntryClearAt?: number },
    products: ReadonlyArray<{ pluginId: string }>
  ): string {
    const hours = reiHoursFor(
      e.occurredAt,
      e.reEntryClearAt,
      products.map(
        (p) =>
          (registry.get(p.pluginId)?.plugin as { reEntryIntervalHours?: number } | undefined)
            ?.reEntryIntervalHours
      )
    );
    return hours === undefined ? '' : String(hours);
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
    ...fungicides.map((e) => e.performedById),
    ...hay.flatMap((h) => (h.cutting.performedById ? [h.cutting.performedById] : []))
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
  } & PollinatorAttestationCells &
    LateCells & {
      mode_of_action: string;
      total_amount_unit: string;
      harvest_quantity: string;
      rei_hours: string;
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
    const commodity = cropCommodityFor(block, e.cropId);
    const wind = e.conditions.windMph;
    const temp = e.conditions.tempF;
    for (const p of e.products) {
      const total = totalAmountApplied(p.rate?.amount, acres);
      const plugin = registry.get(p.pluginId)?.plugin as
        | {
            type?: string;
            displayName?: string;
            epaRegistrationNumber?: string;
            activeIngredients?: { name?: string }[];
          }
        | undefined;
      const epa =
        plugin && (plugin.type === 'herbicide' || plugin.type === 'insecticide')
          ? (plugin.epaRegistrationNumber ?? '')
          : '';
      rows.push({
        date_iso: localDay(e.occurredAt, prefs),
        block_label: block?.blockLabel ?? block?.name ?? e.blockId,
        applicator: applicatorLabel(e.performedById),
        product_name: plugin?.displayName ?? p.pluginId,
        epa_reg_no: epa,
        active_ingredients: activeIngredientNames(plugin),
        rate_per_acre: p.rate?.amount?.toString() ?? '',
        rate_unit: p.rate?.unit ?? '',
        area_acres: acres !== undefined ? String(acres) : '',
        target_pest: '',
        weather_wind_mph: String(wind),
        weather_temp_f: String(temp),
        warning: epa ? '' : 'MISSING_EPA_REG',
        crop_commodity: commodity,
        applicator_cert_no: APPLICATOR_CERT_NO,
        total_amount_applied: total,
        moisture_pct: '',
        record_kind: 'application',
        ...EMPTY_POLLINATOR_CELLS,
        ...UNTRACKED_LATE_CELLS,
        mode_of_action: modeOfActionLabels('herbicide', p.chemistryClasses).join(' / '),
        total_amount_unit: totalAmountUnit(p.rate, total),
        harvest_quantity: '',
        rei_hours: ''
      });
    }
  }

  function rowsForInsecticideEvent(e: (typeof insecticides)[number]) {
    const block = blocks.get(e.blockId);
    const acres = block?.acres;
    const commodity = cropCommodityFor(block, e.cropId);
    const wind = e.conditions.windMph;
    const temp = e.conditions.tempF;
    const rei = reiCell(e, e.products);
    for (const p of e.products) {
      const total = totalAmountApplied(p.rate?.amount, acres);
      const plugin = registry.get(p.pluginId)?.plugin as
        | { type?: string; epaRegistrationNumber?: string; activeIngredients?: { name?: string }[] }
        | undefined;
      const epa =
        plugin && plugin.type === 'insecticide' ? (plugin.epaRegistrationNumber ?? '') : '';
      rows.push({
        date_iso: localDay(e.occurredAt, prefs),
        block_label: block?.blockLabel ?? block?.name ?? e.blockId,
        applicator: applicatorLabel(e.performedById),
        product_name: p.displayName,
        epa_reg_no: epa,
        active_ingredients: activeIngredientNames(plugin),
        rate_per_acre: p.rate?.amount?.toString() ?? '',
        rate_unit: p.rate?.unit ?? '',
        area_acres: acres !== undefined ? String(acres) : '',
        target_pest: recordedTarget(e),
        weather_wind_mph: String(wind),
        weather_temp_f: String(temp),
        warning: epa ? '' : 'MISSING_EPA_REG',
        crop_commodity: commodity,
        applicator_cert_no: APPLICATOR_CERT_NO,
        total_amount_applied: total,
        moisture_pct: '',
        record_kind: 'application',
        ...pollinatorAttestationCells(e),
        ...UNTRACKED_LATE_CELLS,
        mode_of_action: modeOfActionLabels('insecticide', p.iracGroups).join(' / '),
        total_amount_unit: totalAmountUnit(p.rate, total),
        harvest_quantity: '',
        rei_hours: rei
      });
    }
  }

  function rowsForFungicideEvent(e: (typeof fungicides)[number]) {
    const block = blocks.get(e.blockId);
    const acres = block?.acres;
    const commodity = cropCommodityFor(block, e.cropId);
    const wind = e.conditions.windMph;
    const temp = e.conditions.tempF;
    const rei = reiCell(e, e.products);
    for (const p of e.products) {
      const total = totalAmountApplied(p.rate?.amount, acres);
      const plugin = registry.get(p.pluginId)?.plugin as
        | { type?: string; epaRegistrationNumber?: string; activeIngredients?: { name?: string }[] }
        | undefined;
      const epa = plugin && plugin.type === 'fungicide' ? (plugin.epaRegistrationNumber ?? '') : '';
      rows.push({
        date_iso: localDay(e.occurredAt, prefs),
        block_label: block?.blockLabel ?? block?.name ?? e.blockId,
        applicator: applicatorLabel(e.performedById),
        product_name: p.displayName,
        epa_reg_no: epa,
        active_ingredients: activeIngredientNames(plugin),
        rate_per_acre: p.rate?.amount?.toString() ?? '',
        rate_unit: p.rate?.unit ?? '',
        area_acres: acres !== undefined ? String(acres) : '',
        target_pest: recordedTarget(e),
        weather_wind_mph: String(wind),
        weather_temp_f: String(temp),
        warning: epa ? '' : 'MISSING_EPA_REG',
        crop_commodity: commodity,
        applicator_cert_no: APPLICATOR_CERT_NO,
        total_amount_applied: total,
        moisture_pct: '',
        record_kind: 'application',
        ...EMPTY_POLLINATOR_CELLS,
        ...UNTRACKED_LATE_CELLS,
        mode_of_action: modeOfActionLabels('fungicide', p.fracCodes).join(' / '),
        total_amount_unit: totalAmountUnit(p.rate, total),
        harvest_quantity: '',
        rei_hours: rei
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
      date_iso: localDay(e.occurredAt, prefs),
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
      total_amount_applied: '',
      moisture_pct: e.moisturePct !== undefined ? String(e.moisturePct) : '',
      record_kind: 'harvest',
      ...EMPTY_POLLINATOR_CELLS,
      ...UNTRACKED_LATE_CELLS,
      mode_of_action: '',
      total_amount_unit: '',
      harvest_quantity: e.quantity ?? '',
      rei_hours: ''
    });
  }

  // G2-07: a hay cutting is cut off ground an inspector checks against
  // haying intervals. Application columns stay blank; record_kind = 'hay'.
  function rowsForHayCutting(h: HayExportRow) {
    const c = h.cutting;
    const block = blocks.get(c.blockId);
    const plugin = registry.get(c.cropPluginId)?.plugin as { displayName?: string } | undefined;
    rows.push({
      date_iso: localDay(h.occurredAt, prefs),
      block_label: block?.blockLabel ?? block?.name ?? c.blockId,
      applicator: c.performedById ? applicatorLabel(c.performedById) : '',
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
      crop_commodity: plugin?.displayName ?? c.cropPluginId,
      applicator_cert_no: '',
      total_amount_applied: '',
      moisture_pct: c.baleMoisturePct !== undefined ? String(c.baleMoisturePct) : '',
      record_kind: 'hay',
      ...EMPTY_POLLINATOR_CELLS,
      ...lateCells(c.recordedLate, h.daysLate),
      mode_of_action: '',
      total_amount_unit: '',
      harvest_quantity: '',
      rei_hours: ''
    });
  }

  for (const e of sprays) rowsForSprayEvent(e);
  for (const e of insecticides) rowsForInsecticideEvent(e);
  for (const e of fungicides) rowsForFungicideEvent(e);
  for (const e of harvests) rowsForHarvestEvent(e);
  for (const h of hay) rowsForHayCutting(h);

  rows.sort((a, b) => a.date_iso.localeCompare(b.date_iso));

  const csvBody = papa.unparse(rows, { header: true });
  const now = new Date();
  const generatedAt = now.toISOString();
  const signatureLine = `# Generated by CropCard v${APP_VERSION} on ${generatedAt} · exported by ${identityLabel(user)} · date_iso is the local date in ${zoneCaption(prefs, now)}`;
  const csv = `${csvBody}\n${signatureLine}\n`;
  const stamp = localDay(now, prefs);

  return new Response(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="cropcard-usda-pesticide-records-${stamp}.csv"`,
      'X-CropCard-Generator': `CropCard/${APP_VERSION}`,
      'X-CropCard-Exported-By': identityLabel(user)
    }
  });
};

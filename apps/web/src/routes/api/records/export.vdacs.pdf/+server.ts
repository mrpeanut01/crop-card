/**
 * GET /api/records/export.vdacs.pdf
 *
 * VDACS-formatted audit-pack PDF (#161, extended #326). Strictly broader
 * than the existing /api/spray/records/export.pdf — covers spray +
 * insecticide + fungicide + harvest + hay + decon + fertility events in one
 * document, with the active Owner's identity, the rules version, and an
 * integrity hash of the canonical row set. Harvest rows carry stored
 * moisture (UC-16) so a VDACS/NRCS reviewer can accept the pack without a
 * follow-up (UC-22 receiver acceptance).
 *
 * Targets the VDACS Office of Pesticide Services pesticide-records
 * format used at small-farm inspections in Virginia. Same cookie-based
 * auth as the other record exports; cross-tenant isolation is enforced
 * by the underlying `list*` repos.
 *
 * Layout:
 *   - Cover page: farm identity + integrity hash + filter context
 *   - Pesticide application table (chronological, all three flows); the
 *     Pollinator column carries the #130 bloom attestation + gate verdict
 *     on insecticide rows (blank on other kinds and pre-#130 rows)
 *   - Integrity note: SHA-256 of the canonical row set + per-record plugin hashes
 *   - Per-page header (farm + date + page #) and signature footer
 */

import { createHash } from 'node:crypto';
import { type RequestEvent, type RequestHandler } from '@sveltejs/kit';
import {
  areaTreatedLine,
  conditionsText,
  perAcre,
  totalAppliedLine
} from '$lib/records/vdacsColumns';
import { renderPdf } from '$lib/server/pdf';
import { vdacsDoc } from '$lib/server/render/docs/vdacs';
import { withRenderRefusal } from '$lib/server/render/refusal';
import { eq } from 'drizzle-orm';

import { and, desc, gte, lte } from 'drizzle-orm';

import { evaluateLock, listSprayEvents } from '$lib/db/sprayEvents';
import { listInsecticideEvents } from '$lib/db/insecticideEvents';
import { listFungicideEvents } from '$lib/db/fungicideEvents';
import { listHarvestEvents } from '$lib/db/harvestEvents';
import { listBlocks } from '$lib/db/blocks';
import { listSprayers } from '$lib/db/sprayers';
import { getRegistry } from '$lib/server/registry';
import { RULES_VERSION } from '$lib/safety/version';
import { requireUser } from '$lib/server/auth';
import { db } from '$lib/db/client';
import { equipment, equipmentLog, fertilityApplications, owners, users } from '$lib/db/schema';
import { unscopedQueryNote, withTenant } from '$lib/db/tenant';
import { APP_VERSION } from '$lib/version';
import { pollinatorAttestationSummary } from '$lib/records/pollinatorAttestation';
import { identityLabel } from '$lib/identity';
import { parseExportDateRange } from '$lib/exports/dateRange';
import { localDay, localStamp, zoneCaption } from '$lib/exports/localTime';
import { prefsFor } from '$lib/db/userProfile';
import { formatInstant, zoneAbbrev } from '$lib/prefs';
import { LOCK_WINDOW_MS } from '$lib/db/recordKinds';
import { listHayForExport } from '$lib/records/hayExport.server';
import { lateLabel } from '$lib/records/lateLabel';

function ownerNameOf(ownerId: string | null): string {
  if (!ownerId) return '(unknown farm)';
  unscopedQueryNote('VDACS export footer reads the active Owner for the cover page');
  const row = db.select({ name: owners.name }).from(owners).where(eq(owners.id, ownerId)).get();
  return row?.name ?? '(unknown farm)';
}

function performerNameOf(userId: string): string {
  unscopedQueryNote('VDACS export needs human-readable applicator label, users is a global table');
  const row = db
    .select({ email: users.email, phone: users.phone })
    .from(users)
    .where(eq(users.id, userId))
    .get();
  return row ? identityLabel(row) : userId;
}

interface DeconRow {
  id: string;
  occurredAt: number;
  equipmentId: string;
  equipmentLabel: string;
  performedById?: string;
  notes?: string;
}

// #326 — decon events (equipment_log kind='decon'), tenant-scoped so the
// audit pack shows tank clean-outs between pesticide classes.
function listDeconForExport(filters: { fromMs?: number; toMs?: number }): DeconRow[] {
  const conds = [eq(equipmentLog.kind, 'decon')];
  if (filters.fromMs !== undefined)
    conds.push(gte(equipmentLog.occurredAt, new Date(filters.fromMs)));
  if (filters.toMs !== undefined) conds.push(lte(equipmentLog.occurredAt, new Date(filters.toMs)));
  return db
    .select({
      id: equipmentLog.id,
      occurredAt: equipmentLog.occurredAt,
      performedById: equipmentLog.performedById,
      notes: equipmentLog.notes,
      equipmentLabel: equipment.label,
      equipmentId: equipmentLog.equipmentId
    })
    .from(equipmentLog)
    .leftJoin(equipment, and(eq(equipment.id, equipmentLog.equipmentId), withTenant(equipment)))
    .where(withTenant(equipmentLog, and(...conds)))
    .orderBy(desc(equipmentLog.occurredAt))
    .all()
    .map((r) => ({
      id: r.id,
      occurredAt: r.occurredAt.getTime(),
      equipmentId: r.equipmentId,
      equipmentLabel: r.equipmentLabel ?? r.equipmentId,
      performedById: r.performedById ?? undefined,
      notes: r.notes ?? undefined
    }));
}

interface FertilityRow {
  id: string;
  occurredAt: number;
  blockId: string;
  source: string;
  ratePerAcre: number;
  rateUnit: string;
  nLbPerAcre: number;
  pLbPerAcre: number;
  kLbPerAcre: number;
  performedById?: string;
}

// #326 — fertility applications across every block for the active tenant.
function listFertilityForExport(filters: {
  blockId?: string;
  fromMs?: number;
  toMs?: number;
}): FertilityRow[] {
  const conds = [];
  if (filters.blockId) conds.push(eq(fertilityApplications.blockId, filters.blockId));
  if (filters.fromMs !== undefined)
    conds.push(gte(fertilityApplications.occurredAt, new Date(filters.fromMs)));
  if (filters.toMs !== undefined)
    conds.push(lte(fertilityApplications.occurredAt, new Date(filters.toMs)));
  return db
    .select()
    .from(fertilityApplications)
    .where(withTenant(fertilityApplications, conds.length ? and(...conds) : undefined))
    .orderBy(desc(fertilityApplications.occurredAt))
    .all()
    .map((r) => ({
      id: r.id,
      occurredAt: r.occurredAt.getTime(),
      blockId: r.blockId,
      source: r.source,
      ratePerAcre: r.ratePerAcreHundredths / 100,
      rateUnit: r.rateUnit,
      nLbPerAcre: r.nDeliveredHundredths / 100,
      pLbPerAcre: r.pDeliveredHundredths / 100,
      kLbPerAcre: r.kDeliveredHundredths / 100,
      performedById: r.performedById ?? undefined
    }));
}

interface UnifiedRow {
  kind: 'spray' | 'insecticide' | 'fungicide' | 'harvest' | 'hay' | 'decon' | 'fertility';
  id: string;
  occurredAt: number;
  blockLabel: string;
  sprayerLabel: string;
  performer: string;
  productLines: string;
  conditionLine: string;
  rulesVersion: string;
  pluginHashes: Record<string, string>;
  locked: boolean;
  customRateOverride: boolean;
  /** #130 — pollinator-gate attestation; '' for other kinds and legacy rows. */
  pollinatorLine: string;
  /** Area treated (the block's size on file). */
  areaLine?: string;
  /** Product applied in total: per-acre rate × area. */
  totalLine?: string;
}

export const GET: RequestHandler = (event) => withRenderRefusal(event, () => exportPdf(event));

async function exportPdf(event: RequestEvent): Promise<Response> {
  const user = requireUser(event);
  const prefs = prefsFor(user.id);
  const sprayerId = event.url.searchParams.get('sprayerId') ?? undefined;
  const blockId = event.url.searchParams.get('blockId') ?? undefined;
  const fromMsRaw = event.url.searchParams.get('from');
  const toMsRaw = event.url.searchParams.get('to');
  const { fromMs, toMs } = parseExportDateRange(event.url.searchParams, prefs);

  const sprayers = listSprayers();
  const sprayerLabelById = new Map(sprayers.map((s) => [s.id, s.label]));
  const blocks = listBlocks();
  const blockLabelById = new Map(blocks.map((b) => [b.id, b.blockLabel ?? b.name]));
  const blockAcresById = new Map(blocks.map((b) => [b.id, b.acres ?? null]));
  const registry = await getRegistry();
  const farmName = ownerNameOf(user.activeOwnerId);
  const generatedAt = new Date();
  const generatedDay = localDay(generatedAt, prefs);

  const sprays = listSprayEvents({
    sprayerId,
    blockId,
    fromMs,
    toMs,
    limit: 10_000
  });
  // A sprayer filter keeps only that sprayer's applications and decons;
  // harvest, hay and fertility rows have no sprayer, so they are left out.
  const onSprayer = (e: { sprayerId?: string | null }) => !sprayerId || e.sprayerId === sprayerId;
  const insecticides = listInsecticideEvents({
    blockId,
    fromMs,
    toMs,
    limit: 10_000
  }).filter(onSprayer);
  const fungicides = listFungicideEvents({
    blockId,
    fromMs,
    toMs,
    limit: 10_000
  }).filter(onSprayer);
  const harvests = sprayerId ? [] : listHarvestEvents({ blockId, fromMs, toMs });
  const hays = sprayerId ? [] : listHayForExport({ blockId, fromMs, toMs });
  const decons = listDeconForExport({ fromMs, toMs }).filter(
    (d) => !sprayerId || d.equipmentId === sprayerId
  );
  const fertilities = sprayerId ? [] : listFertilityForExport({ blockId, fromMs, toMs });

  const unified: UnifiedRow[] = [];

  for (const ev of sprays) {
    const productLines = ev.products
      .map((p) => {
        const plugin = registry.get(p.pluginId)?.plugin;
        const name = plugin && 'displayName' in plugin ? plugin.displayName : p.pluginId;
        const epa =
          plugin && (plugin.type === 'herbicide' || plugin.type === 'insecticide')
            ? plugin.epaRegistrationNumber
            : undefined;
        const rate = perAcre(p.rate);
        return [name, epa ? `EPA ${epa}` : 'EPA missing', rate].filter(Boolean).join(' · ');
      })
      .join('\n');
    const sprayNames = ev.products.map((p) => {
      const plugin = registry.get(p.pluginId)?.plugin;
      return {
        name: plugin && 'displayName' in plugin ? plugin.displayName : p.pluginId,
        rate: p.rate
      };
    });
    unified.push({
      kind: 'spray',
      id: ev.id,
      occurredAt: ev.occurredAt,
      blockLabel: blockLabelById.get(ev.blockId) ?? ev.blockId,
      sprayerLabel: sprayerLabelById.get(ev.sprayerId) ?? ev.sprayerId,
      performer: performerNameOf(ev.performedById),
      productLines,
      conditionLine: conditionsText(
        `${ev.conditions.windMph}mph / ${ev.conditions.tempF}°F / ${ev.conditions.rainForecastMmNext24h}mm`,
        ev.conditions.conditionsProvenance
      ),
      rulesVersion: ev.rulesVersion,
      pluginHashes: ev.pluginHashes,
      locked: evaluateLock(ev) !== undefined,
      customRateOverride: ev.customRateOverride === true,
      pollinatorLine: '',
      areaLine: areaTreatedLine(blockAcresById.get(ev.blockId)),
      totalLine: totalAppliedLine(sprayNames, blockAcresById.get(ev.blockId))
    });
  }
  for (const ev of insecticides) {
    const productLines = ev.products
      .map((p) => {
        const plugin = registry.get(p.pluginId)?.plugin;
        const epa =
          plugin && plugin.type === 'insecticide' ? plugin.epaRegistrationNumber : undefined;
        const irac = p.iracGroups.length ? ` · IRAC ${p.iracGroups.join('/')}` : '';
        const rate = p.rate ? ` · ${perAcre(p.rate)}` : '';
        return `${p.displayName}${irac} · ${epa ? `EPA ${epa}` : 'EPA missing'}${rate}`;
      })
      .join('\n');
    unified.push({
      kind: 'insecticide',
      id: ev.id,
      occurredAt: ev.occurredAt,
      blockLabel: blockLabelById.get(ev.blockId) ?? ev.blockId,
      sprayerLabel: ev.sprayerId ? (sprayerLabelById.get(ev.sprayerId) ?? ev.sprayerId) : '—',
      performer: performerNameOf(ev.performedById),
      productLines,
      conditionLine: conditionsText(
        `${ev.conditions.windMph}mph / ${ev.conditions.tempF}°F`,
        (ev.conditions as { conditionsProvenance?: string }).conditionsProvenance
      ),
      rulesVersion: ev.rulesVersion,
      pluginHashes: ev.pluginHashes,
      locked: Boolean(ev.lockedAt),
      customRateOverride: false,
      pollinatorLine: pollinatorAttestationSummary(ev),
      areaLine: areaTreatedLine(blockAcresById.get(ev.blockId)),
      totalLine: totalAppliedLine(
        ev.products.map((p) => ({ name: p.displayName, rate: p.rate })),
        blockAcresById.get(ev.blockId)
      )
    });
  }
  for (const ev of fungicides) {
    const productLines = ev.products
      .map((p) => {
        const frac = p.fracCodes.length ? ` · FRAC ${p.fracCodes.join('/')}` : '';
        const rate = p.rate ? ` · ${perAcre(p.rate)}` : '';
        return `${p.displayName}${frac}${rate}`;
      })
      .join('\n');
    unified.push({
      kind: 'fungicide',
      id: ev.id,
      occurredAt: ev.occurredAt,
      blockLabel: blockLabelById.get(ev.blockId) ?? ev.blockId,
      sprayerLabel: ev.sprayerId ? (sprayerLabelById.get(ev.sprayerId) ?? ev.sprayerId) : '—',
      performer: performerNameOf(ev.performedById),
      productLines,
      conditionLine: conditionsText(
        `${ev.conditions.windMph}mph / ${ev.conditions.tempF}°F`,
        (ev.conditions as { conditionsProvenance?: string }).conditionsProvenance
      ),
      rulesVersion: ev.rulesVersion,
      pluginHashes: ev.pluginHashes,
      locked: Boolean(ev.lockedAt),
      customRateOverride: false,
      pollinatorLine: '',
      areaLine: areaTreatedLine(blockAcresById.get(ev.blockId)),
      totalLine: totalAppliedLine(
        ev.products.map((p) => ({ name: p.displayName, rate: p.rate })),
        blockAcresById.get(ev.blockId)
      )
    });
  }
  // #326 — harvest rows carry crop/commodity, quantity, and stored moisture
  // (UC-16) so the inspector can cross-check pre-harvest intervals against
  // the pesticide applications above.
  for (const ev of harvests) {
    const plugin = registry.get(ev.cropPluginId)?.plugin;
    const cropName = plugin && 'displayName' in plugin ? plugin.displayName : ev.cropPluginId;
    const parts = [
      cropName,
      ev.quantity ? `qty ${ev.quantity}` : '',
      ev.lotNumber ? `lot ${ev.lotNumber}` : '',
      ev.moisturePct !== undefined ? `${ev.moisturePct}% moisture` : ''
    ].filter(Boolean);
    unified.push({
      kind: 'harvest',
      id: ev.id,
      occurredAt: ev.occurredAt,
      blockLabel: blockLabelById.get(ev.blockId) ?? ev.blockId,
      sprayerLabel: '—',
      performer: '—',
      productLines: parts.join(' · '),
      conditionLine: '—',
      rulesVersion: RULES_VERSION,
      pluginHashes: {},
      locked: Boolean(ev.lockedAt),
      customRateOverride: false,
      pollinatorLine: ''
    });
  }
  // G2-07: hay cuttings, so haying intervals can be checked against the
  // applications above. A late save is noted in the detail cell (G2-08).
  for (const { cutting: c, occurredAt, daysLate } of hays) {
    const plugin = registry.get(c.cropPluginId)?.plugin;
    const cropName = plugin && 'displayName' in plugin ? plugin.displayName : c.cropPluginId;
    const bale =
      c.balesQuantity !== undefined && c.baleType
        ? `${c.balesQuantity} ${c.baleType}`
        : (c.baleType ?? '');
    const late = lateLabel(c.recordedLate, daysLate);
    const parts = [
      cropName,
      `cutting ${c.cuttingNumber}`,
      c.status,
      bale,
      c.baleMoisturePct !== undefined ? `${c.baleMoisturePct}% moisture` : ''
    ].filter(Boolean);
    unified.push({
      kind: 'hay',
      id: c.id,
      occurredAt,
      blockLabel: blockLabelById.get(c.blockId) ?? c.blockId,
      sprayerLabel: '—',
      performer: c.performedById ? performerNameOf(c.performedById) : '—',
      productLines: parts.join(' · ') + (late ? `\n${late}.` : ''),
      conditionLine: '—',
      rulesVersion: c.rulesVersion,
      pluginHashes: {},
      locked: Date.now() - occurredAt >= LOCK_WINDOW_MS,
      customRateOverride: false,
      pollinatorLine: ''
    });
  }
  // #326 — decon (tank clean-out) events between pesticide classes.
  for (const ev of decons) {
    unified.push({
      kind: 'decon',
      id: ev.id,
      occurredAt: ev.occurredAt,
      blockLabel: '—',
      sprayerLabel: ev.equipmentLabel,
      performer: ev.performedById ? performerNameOf(ev.performedById) : '—',
      productLines: ev.notes ? `decon · ${ev.notes}` : 'decon',
      conditionLine: '—',
      rulesVersion: RULES_VERSION,
      pluginHashes: {},
      locked: false,
      customRateOverride: false,
      pollinatorLine: ''
    });
  }
  // #326 — fertility applications (N/P/K delivered per acre).
  for (const ev of fertilities) {
    const npk = [
      ev.nLbPerAcre ? `N ${ev.nLbPerAcre.toFixed(0)}` : '',
      ev.pLbPerAcre ? `P ${ev.pLbPerAcre.toFixed(0)}` : '',
      ev.kLbPerAcre ? `K ${ev.kLbPerAcre.toFixed(0)}` : ''
    ]
      .filter(Boolean)
      .join(' / ');
    unified.push({
      kind: 'fertility',
      id: ev.id,
      occurredAt: ev.occurredAt,
      blockLabel: blockLabelById.get(ev.blockId) ?? ev.blockId,
      sprayerLabel: '—',
      performer: ev.performedById ? performerNameOf(ev.performedById) : '—',
      productLines: `${ev.source} · ${ev.ratePerAcre} ${ev.rateUnit}${npk ? ` · ${npk} lb/ac` : ''}`,
      conditionLine: '—',
      rulesVersion: RULES_VERSION,
      pluginHashes: {},
      locked: false,
      customRateOverride: false,
      pollinatorLine: ''
    });
  }

  unified.sort((a, b) => a.occurredAt - b.occurredAt);

  const canonicalPayload = unified.map((r) => ({
    k: r.kind,
    id: r.id,
    o: r.occurredAt,
    b: r.blockLabel,
    rv: r.rulesVersion,
    ph: r.pluginHashes
  }));
  const integrityHash = createHash('sha256').update(JSON.stringify(canonicalPayload)).digest('hex');

  const filterContext: string[] = [];
  if (sprayerId) filterContext.push(`sprayer: ${sprayerLabelById.get(sprayerId) ?? sprayerId}`);
  if (blockId) filterContext.push(`block: ${blockLabelById.get(blockId) ?? blockId}`);
  if (fromMsRaw) filterContext.push(`from: ${fromMsRaw}`);
  if (toMsRaw) filterContext.push(`to: ${toMsRaw}`);
  const filterLine =
    filterContext.length > 0
      ? `Filtered to ${filterContext.join(' · ')}.`
      : 'No filters applied — full record set.';

  const tableBody: unknown[][] = [
    [
      { text: `Date (${zoneCaption(prefs, generatedAt)})`, style: 'th' },
      { text: 'Kind', style: 'th' },
      { text: 'Block', style: 'th' },
      { text: 'Sprayer', style: 'th' },
      { text: 'Product / EPA / Rate per acre', style: 'th' },
      { text: 'Area', style: 'th' },
      { text: 'Total applied', style: 'th' },
      { text: 'Cond.', style: 'th' },
      { text: 'Applicator', style: 'th' },
      { text: 'Pollinator', style: 'th' },
      { text: 'Lock', style: 'th' }
    ]
  ];
  for (const r of unified) {
    tableBody.push([
      localStamp(r.occurredAt, prefs),
      { text: r.kind, style: 'kind' },
      r.blockLabel,
      r.sprayerLabel,
      r.productLines,
      r.areaLine ?? '—',
      r.totalLine ?? '—',
      r.conditionLine,
      r.performer,
      r.pollinatorLine,
      r.locked ? 'LOCKED' : 'editable'
    ]);
  }

  const signatureText = `Generated by CropCard v${APP_VERSION} on ${formatInstant(generatedAt, prefs)} ${zoneAbbrev(prefs, generatedAt)} · exported by ${identityLabel(user)}`;

  const spec = vdacsDoc({
    farmName,
    generatedDay,
    exporter: identityLabel(user),
    filterLine,
    signatureText,
    recordCount: unified.length,
    integrityHash,
    tableBody
  });

  const buffer = await renderPdf(spec, {
    ownerId: user.activeOwnerId ?? '',
    signal: event.request?.signal
  });

  const stamp = generatedAt.toISOString().slice(0, 19).replace(/[:T]/g, '-');
  return new Response(new Uint8Array(buffer), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="cropcard-vdacs-audit-${stamp}.pdf"`,
      'X-CropCard-Generator': `CropCard/${APP_VERSION}`,
      'X-CropCard-Exported-By': identityLabel(user),
      'X-CropCard-Integrity-Hash': integrityHash
    }
  });
}

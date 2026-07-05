/**
 * GET /api/records/export.vdacs.pdf
 *
 * VDACS-formatted audit-pack PDF (#161, extended #326). Strictly broader
 * than the existing /api/spray/records/export.pdf — covers spray +
 * insecticide + fungicide + harvest + decon + fertility events in one
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
 *   - Pesticide application table (chronological, all three flows)
 *   - Hash-chain verification footer with on-device command
 *   - Per-page header (farm + date + page #) and signature footer
 */

import { createHash } from 'node:crypto';
import { type RequestHandler } from '@sveltejs/kit';
import PdfPrinter from 'pdfmake';
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

const fonts = {
  Roboto: {
    normal: 'Helvetica',
    bold: 'Helvetica-Bold',
    italics: 'Helvetica-Oblique',
    bolditalics: 'Helvetica-BoldOblique'
  }
};

const printer = new PdfPrinter(fonts);

function ownerNameOf(ownerId: string | null): string {
  if (!ownerId) return '(unknown farm)';
  unscopedQueryNote('VDACS export footer reads the active Owner for the cover page');
  const row = db.select({ name: owners.name }).from(owners).where(eq(owners.id, ownerId)).get();
  return row?.name ?? '(unknown farm)';
}

function performerNameOf(userId: string): string {
  unscopedQueryNote('VDACS export needs human-readable applicator label, users is a global table');
  const row = db.select({ email: users.email }).from(users).where(eq(users.id, userId)).get();
  return row?.email ?? userId;
}

interface DeconRow {
  id: string;
  occurredAt: number;
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
    .leftJoin(equipment, eq(equipment.id, equipmentLog.equipmentId))
    .where(withTenant(equipmentLog, and(...conds)))
    .orderBy(desc(equipmentLog.occurredAt))
    .all()
    .map((r) => ({
      id: r.id,
      occurredAt: r.occurredAt.getTime(),
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
  kind: 'spray' | 'insecticide' | 'fungicide' | 'harvest' | 'decon' | 'fertility';
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
}

export const GET: RequestHandler = async (event) => {
  const user = requireUser(event);
  const sprayerId = event.url.searchParams.get('sprayerId') ?? undefined;
  const blockId = event.url.searchParams.get('blockId') ?? undefined;
  const fromMsRaw = event.url.searchParams.get('from');
  const toMsRaw = event.url.searchParams.get('to');
  const fromMs = fromMsRaw ? Date.parse(fromMsRaw) : undefined;
  const toMs = toMsRaw ? Date.parse(toMsRaw) + 24 * 60 * 60 * 1000 - 1 : undefined;

  const sprayers = listSprayers();
  const sprayerLabelById = new Map(sprayers.map((s) => [s.id, s.label]));
  const blocks = listBlocks();
  const blockLabelById = new Map(blocks.map((b) => [b.id, b.blockLabel ?? b.name]));
  const registry = await getRegistry();
  const farmName = ownerNameOf(user.activeOwnerId);
  const generatedAt = new Date();

  const sprays = listSprayEvents({
    sprayerId,
    blockId,
    fromMs: Number.isFinite(fromMs) ? fromMs : undefined,
    toMs: Number.isFinite(toMs) ? toMs : undefined,
    limit: 10_000
  });
  const insecticides = listInsecticideEvents({
    blockId,
    fromMs: Number.isFinite(fromMs) ? fromMs : undefined,
    toMs: Number.isFinite(toMs) ? toMs : undefined,
    limit: 10_000
  });
  const fungicides = listFungicideEvents({
    blockId,
    fromMs: Number.isFinite(fromMs) ? fromMs : undefined,
    toMs: Number.isFinite(toMs) ? toMs : undefined,
    limit: 10_000
  });
  const harvests = listHarvestEvents({
    blockId,
    fromMs: Number.isFinite(fromMs) ? fromMs : undefined,
    toMs: Number.isFinite(toMs) ? toMs : undefined
  });
  const decons = listDeconForExport({
    fromMs: Number.isFinite(fromMs) ? fromMs : undefined,
    toMs: Number.isFinite(toMs) ? toMs : undefined
  });
  const fertilities = listFertilityForExport({
    blockId,
    fromMs: Number.isFinite(fromMs) ? fromMs : undefined,
    toMs: Number.isFinite(toMs) ? toMs : undefined
  });

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
        const rate = p.rate ? `${p.rate.amount} ${p.rate.unit}` : '';
        return [name, epa ? `EPA ${epa}` : 'EPA missing', rate].filter(Boolean).join(' · ');
      })
      .join('\n');
    unified.push({
      kind: 'spray',
      id: ev.id,
      occurredAt: ev.occurredAt,
      blockLabel: blockLabelById.get(ev.blockId) ?? ev.blockId,
      sprayerLabel: sprayerLabelById.get(ev.sprayerId) ?? ev.sprayerId,
      performer: performerNameOf(ev.performedById),
      productLines,
      conditionLine: `${ev.conditions.windMph}mph / ${ev.conditions.tempF}°F / ${ev.conditions.rainForecastMmNext24h}mm`,
      rulesVersion: ev.rulesVersion,
      pluginHashes: ev.pluginHashes,
      locked: evaluateLock(ev) !== undefined,
      customRateOverride: ev.customRateOverride === true
    });
  }
  for (const ev of insecticides) {
    const productLines = ev.products
      .map((p) => {
        const plugin = registry.get(p.pluginId)?.plugin;
        const epa =
          plugin && plugin.type === 'insecticide' ? plugin.epaRegistrationNumber : undefined;
        const irac = p.iracGroups.length ? ` · IRAC ${p.iracGroups.join('/')}` : '';
        const rate = p.rate ? ` · ${p.rate.amount} ${p.rate.unit}` : '';
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
      conditionLine: `${ev.conditions.windMph}mph / ${ev.conditions.tempF}°F`,
      rulesVersion: ev.rulesVersion,
      pluginHashes: ev.pluginHashes,
      locked: Boolean(ev.lockedAt),
      customRateOverride: false
    });
  }
  for (const ev of fungicides) {
    const productLines = ev.products
      .map((p) => {
        const frac = p.fracCodes.length ? ` · FRAC ${p.fracCodes.join('/')}` : '';
        const rate = p.rate ? ` · ${p.rate.amount} ${p.rate.unit}` : '';
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
      conditionLine: `${ev.conditions.windMph}mph / ${ev.conditions.tempF}°F`,
      rulesVersion: ev.rulesVersion,
      pluginHashes: ev.pluginHashes,
      locked: Boolean(ev.lockedAt),
      customRateOverride: false
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
      customRateOverride: false
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
      customRateOverride: false
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
      productLines: `${ev.source} · ${ev.ratePerAcre} ${ev.rateUnit}${npk ? ` · ${npk}` : ''}`,
      conditionLine: '—',
      rulesVersion: RULES_VERSION,
      pluginHashes: {},
      locked: false,
      customRateOverride: false
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
      { text: 'Date', style: 'th' },
      { text: 'Kind', style: 'th' },
      { text: 'Block', style: 'th' },
      { text: 'Sprayer', style: 'th' },
      { text: 'Product / EPA / Rate', style: 'th' },
      { text: 'Cond.', style: 'th' },
      { text: 'Applicator', style: 'th' },
      { text: 'Lock', style: 'th' }
    ]
  ];
  for (const r of unified) {
    tableBody.push([
      new Date(r.occurredAt).toISOString().replace('T', ' ').slice(0, 16),
      { text: r.kind, style: 'kind' },
      r.blockLabel,
      r.sprayerLabel,
      r.productLines,
      r.conditionLine,
      r.performer,
      r.locked ? 'LOCKED' : 'editable'
    ]);
  }

  const signatureText = `Generated by CropCard v${APP_VERSION} on ${generatedAt.toISOString()} · exported by ${user.email}`;

  type DocDefWithChrome = Parameters<typeof printer.createPdfKitDocument>[0] & {
    header?: (currentPage: number, pageCount: number) => unknown;
    footer?: (currentPage: number, pageCount: number) => unknown;
  };
  const docDef: DocDefWithChrome = {
    info: {
      title: `CropCard VDACS audit pack — ${farmName}`,
      author: 'CropCard',
      subject: 'VDACS pesticide-record compliance export',
      creator: `CropCard v${APP_VERSION}`,
      producer: `CropCard v${APP_VERSION}`
    },
    pageSize: 'LETTER',
    pageOrientation: 'landscape',
    pageMargins: [40, 80, 40, 60],
    header: (currentPage: number) => {
      if (currentPage === 1) {
        return {
          stack: [
            { text: farmName, style: 'farmName' },
            {
              text: `VDACS audit pack · ${generatedAt.toISOString().slice(0, 10)} · ${user.email} · ${filterLine}`,
              style: 'farmSub'
            }
          ],
          margin: [40, 24, 40, 0]
        };
      }
      return {
        text: `${farmName} · VDACS audit · ${generatedAt.toISOString().slice(0, 10)} · page ${currentPage}`,
        style: 'farmSub',
        margin: [40, 24, 40, 0]
      };
    },
    footer: (currentPage: number, pageCount: number) => ({
      columns: [
        { text: signatureText, style: 'footer' },
        { text: `page ${currentPage} / ${pageCount}`, style: 'footer', alignment: 'right' }
      ],
      margin: [40, 0, 40, 24]
    }),
    content: [
      { text: 'VDACS audit pack', style: 'h1' },
      {
        text: `${unified.length} record(s) — spray/insecticide/fungicide + harvest/decon/fertility · rules ${RULES_VERSION} · app v${APP_VERSION}`,
        style: 'sub'
      },
      {
        text: `Integrity hash: ${integrityHash}`,
        style: 'mono',
        margin: [0, 0, 0, 12]
      },
      {
        text: `Hash-chain verification: run \`cropcard verify --hash=${integrityHash.slice(0, 12)}…\` to confirm the record set has not been tampered with since export.`,
        style: 'sub',
        margin: [0, 0, 0, 12]
      },
      {
        table: {
          headerRows: 1,
          widths: ['auto', 'auto', 60, 60, '*', 'auto', 'auto', 'auto'],
          body: tableBody
        },
        layout: {
          fillColor: (rowIndex: number) => (rowIndex === 0 ? '#1f5e3a' : null),
          hLineColor: () => '#cccccc',
          vLineColor: () => '#cccccc'
        }
      },
      {
        text: '\nRetention: minimum 2 years from occurrence (NFR-05). Records are immutable after the 48-hour FR-09 lock window. Plugin hashes embedded per record allow tamper-evident auditing.',
        style: 'sub',
        margin: [0, 16, 0, 0]
      }
    ],
    styles: {
      h1: { fontSize: 16, bold: true, color: '#1f5e3a', margin: [0, 0, 0, 4] },
      sub: { fontSize: 9, color: '#555555' },
      th: { color: 'white', bold: true, fontSize: 9 },
      kind: { fontSize: 9, bold: true, color: '#1f5e3a' },
      mono: { fontSize: 8, color: '#1f5e3a' },
      farmName: { fontSize: 13, bold: true, color: '#1f5e3a' },
      farmSub: { fontSize: 8, color: '#555555' },
      footer: { fontSize: 8, color: '#777777' }
    },
    defaultStyle: { fontSize: 9, font: 'Roboto' }
  };

  const pdfDoc = printer.createPdfKitDocument(docDef);
  const chunks: Buffer[] = [];
  pdfDoc.on('data', (chunk: Buffer) => chunks.push(chunk));
  pdfDoc.end();
  const buffer: Buffer = await new Promise((resolve, reject) => {
    pdfDoc.on('end', () => resolve(Buffer.concat(chunks)));
    pdfDoc.on('error', reject);
  });

  const stamp = generatedAt.toISOString().slice(0, 19).replace(/[:T]/g, '-');
  return new Response(new Uint8Array(buffer), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="cropcard-vdacs-audit-${stamp}.pdf"`,
      'X-CropCard-Generator': `CropCard/${APP_VERSION}`,
      'X-CropCard-Exported-By': user.email,
      'X-CropCard-Integrity-Hash': integrityHash
    }
  });
};

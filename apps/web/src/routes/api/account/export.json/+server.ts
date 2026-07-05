/**
 * GET /api/account/export.json
 *
 * GDPR-style account export (#205). The legacy "Download account data"
 * link in /settings/account pointed at /api/spray/records/export.csv,
 * which gives an inspector-flavored spray CSV — not the full account
 * dump the GDPR / CCPA Right-to-Data requests expect.
 *
 * Returns a JSON manifest of every tenant-scoped event + the operator's
 * profile in one file. Stays tenant-scoped via the existing `list*`
 * pipelines and `withTenant` queries; cross-tenant data never leaks
 * because every read funnels through the tenant filter.
 *
 * The `events` object mirrors every kind in `summary.countsByKind`
 * (spray, insecticide, fungicide, scout, harvest, fertility, planting,
 * decon) so the two reconcile (#328). Hay cuttings and API-token
 * METADATA (never the plaintext token or its hash) round out the dump.
 *
 * Bigger objects (PDF audit pack, plugin snapshot zip) are linked, not
 * inlined, so the JSON stays under a few MB even for active farms.
 */

import { type RequestHandler } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { db } from '$lib/db/client';
import { equipment, equipmentLog, fertilityApplications, owners, users } from '$lib/db/schema';
import { unscopedQueryNote, withTenant } from '$lib/db/tenant';
import { listSprayEvents } from '$lib/db/sprayEvents';
import { listInsecticideEvents } from '$lib/db/insecticideEvents';
import { listFungicideEvents } from '$lib/db/fungicideEvents';
import { listScoutObservations } from '$lib/db/scoutObservations';
import { listHarvestEvents } from '$lib/db/harvestEvents';
import { listCuttings } from '$lib/db/hayCuttings';
import { listBlocks } from '$lib/db/blocks';
import { listSprayers } from '$lib/db/sprayers';
import { listUnifiedRecords, summarizeUnifiedRecords } from '$lib/db/recordsUnified';
import { listTokensForOwner } from '$lib/server/apiTokens';
import { requireUser } from '$lib/server/auth';
import { APP_VERSION } from '$lib/version';
import { RULES_VERSION } from '$lib/safety/version';

export const GET: RequestHandler = async (event) => {
  const user = requireUser(event);
  unscopedQueryNote('GDPR export reads the user identity and active owner row');
  const userRow = db.select().from(users).where(eq(users.id, user.id)).get();
  const ownerRow = user.activeOwnerId
    ? db.select().from(owners).where(eq(owners.id, user.activeOwnerId)).get()
    : null;

  const records = listUnifiedRecords();
  const summary = summarizeUnifiedRecords(records);

  // Fertility applications (tenant-scoped) — mirrors the `fertility` kind in
  // countsByKind so `events` reconciles with the summary.
  const fertilityRows = db
    .select()
    .from(fertilityApplications)
    .where(withTenant(fertilityApplications))
    .all();
  const fertility = fertilityRows.map((r) => ({
    id: r.id,
    blockId: r.blockId,
    occurredAt: r.occurredAt.toISOString(),
    source: r.source,
    ratePerAcre: r.ratePerAcreHundredths / 100,
    rateUnit: r.rateUnit,
    nLbPerAcre: r.nDeliveredHundredths / 100,
    pLbPerAcre: r.pDeliveredHundredths / 100,
    kLbPerAcre: r.kDeliveredHundredths / 100,
    performedById: r.performedById ?? null,
    notes: r.notes ?? null
  }));

  // Decon events live in equipment_log under kind='decon'.
  const deconRows = db
    .select({
      id: equipmentLog.id,
      occurredAt: equipmentLog.occurredAt,
      equipmentId: equipmentLog.equipmentId,
      equipmentLabel: equipment.label,
      performedById: equipmentLog.performedById,
      notes: equipmentLog.notes,
      payloadJson: equipmentLog.payloadJson
    })
    .from(equipmentLog)
    .leftJoin(equipment, eq(equipment.id, equipmentLog.equipmentId))
    .where(withTenant(equipmentLog, eq(equipmentLog.kind, 'decon')))
    .all();
  const decon = deconRows.map((r) => ({
    id: r.id,
    occurredAt: r.occurredAt.toISOString(),
    equipmentId: r.equipmentId,
    equipmentLabel: r.equipmentLabel ?? null,
    performedById: r.performedById ?? null,
    notes: r.notes ?? null,
    payload: r.payloadJson ? JSON.parse(r.payloadJson) : null
  }));

  // Plantings are also nested under `blocks`, but the flat list makes the
  // `planting` kind in countsByKind self-contained inside `events`.
  const planting = listBlocks().flatMap((b) =>
    b.plantings
      .filter((p) => p.plantingDate != null)
      .map((p) => ({
        id: p.id,
        blockId: b.id,
        cropPluginId: p.cropPluginId,
        varietyDisplayName: p.varietyDisplayName ?? null,
        plantingDate: p.plantingDate ? new Date(p.plantingDate).toISOString() : null,
        quantityPlanted: p.quantityPlanted ?? null,
        quantityUnit: p.quantityUnit ?? null
      }))
  );

  // Hay cuttings (tenant-scoped). Not part of the unified-records taxonomy but
  // still the operator's data, so the GDPR dump must include them.
  const hayCuttings = listCuttings({});

  // API-token METADATA only — never the plaintext token or its hash.
  const apiTokens = user.activeOwnerId
    ? listTokensForOwner(user.activeOwnerId).map((t) => ({
        id: t.id,
        label: t.label,
        userId: t.userId,
        isServiceAccount: t.isServiceAccount,
        createdAt: new Date(t.createdAt).toISOString(),
        lastUsedAt: t.lastUsedAt ? new Date(t.lastUsedAt).toISOString() : null,
        requestCount: t.requestCount,
        revokedAt: t.revokedAt ? new Date(t.revokedAt).toISOString() : null
      }))
    : [];

  const payload = {
    schemaVersion: '1.0.0',
    generatedAt: new Date().toISOString(),
    generator: `CropCard v${APP_VERSION}`,
    rulesVersion: RULES_VERSION,
    operator: {
      id: user.id,
      email: user.email,
      isSuperadmin: user.isSuperadmin === true,
      createdAt: userRow?.createdAt?.toISOString() ?? null,
      aiEnabled: userRow?.aiEnabled === true
    },
    activeOwner: ownerRow
      ? {
          id: ownerRow.id,
          name: ownerRow.name,
          slug: ownerRow.slug,
          billingStatus: ownerRow.billingStatus,
          createdAt: ownerRow.createdAt.toISOString()
        }
      : null,
    summary,
    blocks: listBlocks().map((b) => ({
      id: b.id,
      name: b.name,
      blockLabel: b.blockLabel ?? null,
      acres: b.acres ?? null,
      tillageMethod: b.tillageMethod,
      sunExposure: b.sunExposure ?? null,
      plantings: b.plantings.map((p) => ({
        id: p.id,
        cropPluginId: p.cropPluginId,
        varietyDisplayName: p.varietyDisplayName,
        plantingDate: p.plantingDate ? new Date(p.plantingDate).toISOString() : null,
        quantityPlanted: p.quantityPlanted ?? null,
        quantityUnit: p.quantityUnit ?? null
      }))
    })),
    sprayers: listSprayers().map((s) => ({
      id: s.id,
      label: s.label,
      lastChemistryClass: s.lastChemistryClass ?? null,
      calibratedGpa: s.calibratedGpa ?? null
    })),
    events: {
      spray: listSprayEvents({ limit: 10_000 }),
      insecticide: listInsecticideEvents({ limit: 10_000 }),
      fungicide: listFungicideEvents({ limit: 10_000 }),
      scout: listScoutObservations({ limit: 10_000 }),
      harvest: listHarvestEvents(),
      fertility,
      planting,
      decon
    },
    hayCuttings,
    apiTokens,
    relatedDownloads: {
      vdacsAuditPdf: '/api/records/export.vdacs.pdf',
      sprayCsv: '/api/spray/records/export.csv',
      sprayPdf: '/api/spray/records/export.pdf',
      usdaNrcsCsv: '/api/spray/records/export.usda.csv'
    },
    gdprNote:
      'This file is your complete data export for the active Owner under CropCard. Records are immutable per FR-09 once 48 hours past occurrence; to delete account data, contact the farm owner or use /settings/account → Advanced → Delete account.'
  };

  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
  return new Response(JSON.stringify(payload, null, 2), {
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition': `attachment; filename="cropcard-account-export-${stamp}.json"`,
      'X-CropCard-Generator': `CropCard/${APP_VERSION}`,
      'X-CropCard-Exported-By': user.email
    }
  });
};

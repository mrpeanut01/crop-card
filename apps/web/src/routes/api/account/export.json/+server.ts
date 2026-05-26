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
 * pipelines; cross-tenant data never leaks because every repo funnels
 * through `tenantWhere`.
 *
 * Bigger objects (PDF audit pack, plugin snapshot zip) are linked, not
 * inlined, so the JSON stays under a few MB even for active farms.
 */

import { type RequestHandler } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { db } from '$lib/db/client';
import { owners, users } from '$lib/db/schema';
import { unscopedQueryNote } from '$lib/db/tenant';
import { listSprayEvents } from '$lib/db/sprayEvents';
import { listInsecticideEvents } from '$lib/db/insecticideEvents';
import { listFungicideEvents } from '$lib/db/fungicideEvents';
import { listScoutObservations } from '$lib/db/scoutObservations';
import { listHarvestEvents } from '$lib/db/harvestEvents';
import { listBlocks } from '$lib/db/blocks';
import { listSprayers } from '$lib/db/sprayers';
import { listUnifiedRecords, summarizeUnifiedRecords } from '$lib/db/recordsUnified';
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
      harvest: listHarvestEvents()
    },
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

/**
 * The GDPR account export body (A-14). `GET /api/account/export.json`
 * returns it as is and `GET /api/account/export.zip` (33A, A3) writes the
 * same object as `export.json` inside the ZIP.
 *
 * Every tenant-scoped event plus the operator's profile, read through the
 * tenant filter. `events` mirrors every kind in `summary.countsByKind` so the
 * two reconcile (#328). Document metadata (never storage keys) is in the
 * owner's export only; a helper's export leaves `documents` out.
 */

import type { RequestEvent } from '@sveltejs/kit';
import { and, eq } from 'drizzle-orm';
import { db } from '$lib/db/client';
import { equipment, equipmentLog, fertilityApplications, owners, users } from '$lib/db/schema';
import { avatarUrl, avatarVersion, prefsFor } from '$lib/db/userProfile';
import { unscopedQueryNote, withTenant } from '$lib/db/tenant';
import { listSprayEvents } from '$lib/db/sprayEvents';
import { listInsecticideEvents } from '$lib/db/insecticideEvents';
import { listFungicideEvents } from '$lib/db/fungicideEvents';
import { listScoutObservations } from '$lib/db/scoutObservations';
import { listHarvestEvents } from '$lib/db/harvestEvents';
import { listCuttings } from '$lib/db/hayCuttings';
import { listJournalForExport } from '$lib/db/plantingJournal';
import { listConsentHistoryForUser } from '$lib/db/emailAlertConsents';
import { listFeedbackForUser } from '$lib/db/feedback';
import { listBlocks } from '$lib/db/blocks';
import { listSprayers } from '$lib/db/sprayers';
import { listUnifiedRecords, summarizeUnifiedRecords } from '$lib/db/recordsUnified';
import { listTokensForOwner } from '$lib/server/apiTokens';
import { requireUser } from '$lib/server/auth';
import { APP_VERSION } from '$lib/version';
import { RULES_VERSION } from '$lib/safety/version';
import {
  areaSection,
  documentSection,
  journalPhotoFacts,
  phase33Sections,
  mapFeatureAreaSection,
  deletedRecordSection,
  mapFeatureSection,
  recordSections,
  shadeSourceSection,
  soilTestSection
} from './accountExportSections';

export async function buildAccountExport(event: RequestEvent): Promise<Record<string, unknown>> {
  const user = requireUser(event);
  unscopedQueryNote('GDPR export reads the user identity and active owner row');
  const userRow = db.select().from(users).where(eq(users.id, user.id)).get();
  const ownerRow = user.activeOwnerId
    ? db.select().from(owners).where(eq(owners.id, user.activeOwnerId)).get()
    : null;

  const records = listUnifiedRecords();
  const prefs = prefsFor(user.id);
  const summary = summarizeUnifiedRecords(records, prefs);

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
    amendmentBatchId: r.amendmentBatchId ?? null,
    carryoverAck: r.carryoverAckJson ? (JSON.parse(r.carryoverAckJson) as unknown) : null,
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
    .leftJoin(equipment, and(eq(equipment.id, equipmentLog.equipmentId), withTenant(equipment)))
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
  const blockList = listBlocks();
  const planting = blockList.flatMap((b) =>
    b.plantings
      .filter((p) => p.plantingDate != null)
      .map((p) => ({
        id: p.id,
        blockId: b.id,
        cropPluginId: p.cropPluginId,
        varietyDisplayName: p.varietyDisplayName ?? null,
        plantingDate: p.plantingDate ? new Date(p.plantingDate).toISOString() : null,
        quantityPlanted: p.quantityPlanted ?? null,
        quantityUnit: p.quantityUnit ?? null,
        splitGroupId: p.splitGroupId ?? null
      }))
  );

  // Hay cuttings (tenant-scoped). Not part of the unified-records taxonomy but
  // still the operator's data, so the GDPR dump must include them.
  const hayCuttings = listCuttings({});

  // API-token METADATA only — never the plaintext token or its hash.
  // Listing a farm's tokens is owner-only (GET /api/auth/token), so anyone
  // else's export carries only their own.
  const apiTokens = user.activeOwnerId
    ? listTokensForOwner(user.activeOwnerId)
        .filter((t) => user.role === 'owner' || t.userId === user.id)
        .map((t) => ({
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

  const journalPhotos = journalPhotoFacts();

  return {
    schemaVersion: '1.5.0',
    generatedAt: new Date().toISOString(),
    generator: `CropCard v${APP_VERSION}`,
    rulesVersion: RULES_VERSION,
    operator: {
      id: user.id,
      email: user.email,
      phone: user.phone,
      isSuperadmin: user.isSuperadmin === true,
      createdAt: userRow?.createdAt?.toISOString() ?? null,
      aiEnabled: userRow?.aiEnabled === true,
      displayName: userRow?.displayName ?? null,
      timeZone: prefs.timeZone,
      displayUnits: prefs.units,
      avatarUrl: avatarUrl(user.id, avatarVersion(user.id)),
      emailAlertConsents: listConsentHistoryForUser(user.id),
      feedback: listFeedbackForUser(user.id)
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
    areas: areaSection(),
    blocks: blockList.map((b) => ({
      id: b.id,
      name: b.name,
      blockLabel: b.blockLabel ?? null,
      fieldId: b.fieldId ?? null,
      kind: b.kind ?? 'block',
      acres: b.acres ?? null,
      tillageMethod: b.tillageMethod,
      sunExposure: b.sunExposure ?? null,
      slopePercent: b.slopePercent ?? null,
      slopeAspectDeg: b.slopeAspectDeg ?? null,
      geometryGeojson: b.geometryGeojson ?? null,
      widthFt: b.widthFt ?? null,
      lengthFt: b.lengthFt ?? null,
      layout: {
        xFt: b.xFt ?? null,
        yFt: b.yFt ?? null,
        rotationDeg: b.rotationDeg ?? null,
        bedStyle: b.bedStyle ?? null,
        eastWestIndex: b.eastWestIndex ?? null,
        northSouthIndex: b.northSouthIndex ?? null,
        axesLocked: b.axesLocked
      },
      plantings: b.plantings.map((p) => ({
        id: p.id,
        cropPluginId: p.cropPluginId,
        varietyDisplayName: p.varietyDisplayName,
        plantingDate: p.plantingDate ? new Date(p.plantingDate).toISOString() : null,
        quantityPlanted: p.quantityPlanted ?? null,
        quantityUnit: p.quantityUnit ?? null,
        splitGroupId: p.splitGroupId ?? null
      }))
    })),
    mapFeatures: mapFeatureSection(),
    mapFeatureAreas: mapFeatureAreaSection(),
    shadeSources: shadeSourceSection(),
    soilTests: soilTestSection(),
    sprayers: listSprayers().map((s) => ({
      id: s.id,
      label: s.label,
      lastChemistryClass: s.lastChemistryClass ?? null,
      calibratedGpa: s.calibratedGpa ?? null
    })),
    events: {
      spray: listSprayEvents({ limit: 10_000 }),
      insecticide: listInsecticideEvents({ limit: 10_000 }).map((e) => ({
        ...e,
        bloomStatus: e.bloomStatus ?? null,
        bloomStatusSource: e.bloomStatusSource ?? null,
        attestedNoForagers: e.attestedNoForagers ?? null,
        pollinatorVerdict: e.pollinatorVerdict ?? null
      })),
      fungicide: listFungicideEvents({ limit: 10_000 }),
      scout: listScoutObservations({ limit: 10_000 }),
      harvest: listHarvestEvents(),
      fertility,
      planting,
      decon
    },
    hayCuttings,
    deletedRecords: deletedRecordSection(),
    plantingJournal: listJournalForExport().map((e) => ({
      ...e,
      createdAt: new Date(e.createdAt).toISOString(),
      photoDocumentId: journalPhotos.get(e.id)?.photoDocumentId ?? null,
      photoBytes: journalPhotos.get(e.id)?.photoBytes ?? 0
    })),
    ...recordSections(user),
    ...phase33Sections(user),
    documents: documentSection(user),
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
}

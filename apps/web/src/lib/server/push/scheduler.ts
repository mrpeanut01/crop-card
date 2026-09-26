/**
 * NFR-06 — one push alert tick.
 *
 * The app scales to zero, so nothing runs on a timer in the process. An
 * Azure Container Apps Job wakes the app twice a day and POSTs
 * /api/internal/push-tick (see ./wakeup.ts), which calls `runPushTick` once.
 * A tick visits each Owner that has at least one subscription, builds that
 * Owner's snapshot inside `runWithTenantAsync`, selects due alerts
 * (triggers.ts), and claims each in the `push_deliveries` sent-log before
 * sending, so an alert goes out at most once however often ticks run.
 *
 * The same due alerts also go by email to users who opted in to that alert
 * kind on this Owner (emailAlerts.ts). The clock, fetch and NWS fetcher are
 * injectable.
 */

import { eq } from 'drizzle-orm';
import { db } from '$lib/db/client';
import { owners } from '$lib/db/schema';
import { runWithTenantAsync, unscopedQueryNote } from '$lib/db/tenant';
import { usersForOwner } from '$lib/db/users';
import { listSprayers } from '$lib/db/sprayers';
import { listBlocks } from '$lib/db/blocks';
import { listSprayEvents } from '$lib/db/sprayEvents';
import { listInsecticideEvents } from '$lib/db/insecticideEvents';
import { listFungicideEvents } from '$lib/db/fungicideEvents';
import { listCrops } from '$lib/db/crops';
import type { CropPlugin } from '$lib/plugins/schemas';
import { hardinessOf } from '$lib/schedule/scheduleCandidacy';
import { getRegistry } from '$lib/server/registry';
import { resolveWeatherLocation } from '$lib/server/weatherHourly';
import { fetchFrostAlerts, type FrostAlertFetcher } from '$lib/server/nwsAlerts';
import {
  claimDelivery,
  listOwnerIdsWithPushSubscriptions,
  listSubscriptions,
  setDeliveryRecipientCount
} from '$lib/db/pushSubscriptions';
import { listOwnerIdsWithEmailOptIns, listOptedIn } from '$lib/db/emailAlertConsents';
import { selectRecipients, sendToSubscriptions } from './dispatch';
import { emailAlertOrigin, sendAlertEmails } from './emailAlerts';
import { frostTonightAlerts, isInGroundOrImminent, type FrostPlantingSnapshot } from './frost';
import {
  LOCK_WINDOW_MS,
  selectDueAlerts,
  type LockableRecordSnapshot,
  type PushAlert,
  type SprayerSnapshot
} from './triggers';
import type { VapidConfig } from './webPush';

const SKIPPED_BILLING = new Set(['suspended', 'canceled']);

export interface PushTickDeps {
  /** null when push is not configured; alerts can still go by email. */
  config: VapidConfig | null;
  /** Public origin for links in alert emails; null or unset sends no email. */
  emailOrigin?: string | null;
  now?: () => number;
  fetchImpl?: typeof fetch;
  frostAlerts?: FrostAlertFetcher;
}

export interface PushTickSummary {
  owners: number;
  alerts: number;
  sent: number;
  removed: number;
  failed: number;
  emailed: number;
  emailFailed: number;
}

function ownerRow(ownerId: string): { billingStatus: string; name: string } | null {
  unscopedQueryNote('alert scheduler reads the global owners row for billing and the farm name');
  const row = db
    .select({ billingStatus: owners.billingStatus, name: owners.name })
    .from(owners)
    .where(eq(owners.id, ownerId))
    .get();
  return row ?? null;
}

function ownerSnapshot(now: number): {
  sprayers: SprayerSnapshot[];
  records: LockableRecordSnapshot[];
} {
  const sprayers: SprayerSnapshot[] = listSprayers().map((s) => ({
    id: s.id,
    label: s.label,
    calibratedGpa: s.calibratedGpa,
    lastChemistryClass: s.lastChemistryClass ?? null,
    lastSprayedAt: s.lastSprayedAt,
    lastDeconAt: s.lastDeconAt,
    winterizedAt: s.winterizedAt
  }));
  const window = { fromMs: now - LOCK_WINDOW_MS, toMs: now };
  const blockName = new Map(listBlocks({ plantings: 'none' }).map((b) => [b.id, b.name]));
  const records: LockableRecordSnapshot[] = [
    ...listSprayEvents(window).map((e) => ({
      kind: 'spray' as const,
      id: e.id,
      occurredAt: e.occurredAt,
      lockedAt: e.lockedAt ?? null,
      performedById: e.performedById,
      blockName: blockName.get(e.blockId)
    })),
    ...listInsecticideEvents(window).map((e) => ({
      kind: 'insecticide' as const,
      id: e.id,
      occurredAt: e.occurredAt,
      lockedAt: e.lockedAt ?? null,
      performedById: e.performedById,
      blockName: blockName.get(e.blockId)
    })),
    ...listFungicideEvents(window).map((e) => ({
      kind: 'fungicide' as const,
      id: e.id,
      occurredAt: e.occurredAt,
      lockedAt: e.lockedAt ?? null,
      performedById: e.performedById,
      blockName: blockName.get(e.blockId)
    }))
  ];
  return { sprayers, records };
}

/**
 * Opt-in frost alerts. NWS is only asked when a subscription on this Owner has
 * the alert turned on, the farm has a real location, and something frost-tender
 * is planted or about to be. An NWS failure skips this tick; it never throws.
 */
async function frostAlertsForOwner(now: number, deps: PushTickDeps): Promise<PushAlert[]> {
  const pushWants =
    deps.config !== null && listSubscriptions().some((s) => s.prefs['frost-tonight']);
  const emailWants =
    !!deps.emailOrigin && listOptedIn().some((c) => c.category === 'frost-tonight');
  if (!pushWants && !emailWants) return [];
  const crops = listCrops({ statuses: ['active', 'planned'] });
  if (crops.length === 0) return [];
  const registry = await getRegistry();
  const blockName = new Map(listBlocks({ plantings: 'none' }).map((b) => [b.id, b.name]));
  const plantings: FrostPlantingSnapshot[] = [];
  for (const c of crops) {
    const plugin = registry.get(c.cropPluginId)?.plugin;
    const crop = plugin?.type === 'crop' ? (plugin as CropPlugin) : undefined;
    const snapshot: FrostPlantingSnapshot = {
      status: c.status as 'planned' | 'active',
      plantingDate: c.plantingDate,
      name: c.varietyDisplayName || crop?.displayName || c.cropPluginId,
      blockName: blockName.get(c.blockId),
      hardiness: hardinessOf(crop)
    };
    if (snapshot.hardiness !== 'hardy' && isInGroundOrImminent(snapshot, now)) {
      plantings.push(snapshot);
    }
  }
  if (plantings.length === 0) return [];
  const location = resolveWeatherLocation(null);
  if (!location || location.source === 'farm-default') return [];
  try {
    const products = await (deps.frostAlerts ?? fetchFrostAlerts)(location.lat, location.lon, now);
    return frostTonightAlerts(products, plantings, now);
  } catch (err) {
    console.warn('[push] NWS frost alerts unavailable this tick', err);
    return [];
  }
}

/** Process one Owner. Caller must already be inside that Owner's tenant context. */
export async function processOwnerAlerts(
  ownerId: string,
  deps: PushTickDeps
): Promise<Omit<PushTickSummary, 'owners'>> {
  const now = (deps.now ?? Date.now)();
  const summary = { alerts: 0, sent: 0, removed: 0, failed: 0, emailed: 0, emailFailed: 0 };
  const { sprayers, records } = ownerSnapshot(now);
  const alerts = [
    ...selectDueAlerts({ sprayers, records, now }),
    ...(await frostAlertsForOwner(now, deps))
  ];
  if (alerts.length === 0) return summary;
  const members = usersForOwner(ownerId);
  const farmName = ownerRow(ownerId)?.name ?? 'your farm';
  for (const alert of alerts) {
    if (!claimDelivery(alert.kind, alert.subjectId, now)) continue;
    summary.alerts++;
    let delivered = 0;
    const recipients = deps.config ? selectRecipients(listSubscriptions(), members, alert) : [];
    if (deps.config && recipients.length > 0) {
      const result = await sendToSubscriptions(
        recipients,
        {
          title: alert.title,
          body: alert.body,
          url: alert.url,
          tag: `${alert.kind}:${alert.subjectId}`,
          kind: alert.kind
        },
        deps.config,
        { fetchImpl: deps.fetchImpl, nowMs: now, urgency: 'high' }
      );
      delivered += result.sent;
      summary.sent += result.sent;
      summary.removed += result.removed;
      summary.failed += result.failed;
    }
    if (deps.emailOrigin) {
      const mail = await sendAlertEmails(ownerId, farmName, alert, members, deps.emailOrigin);
      delivered += mail.sent;
      summary.emailed += mail.sent;
      summary.emailFailed += mail.failed;
    }
    setDeliveryRecipientCount(alert.kind, alert.subjectId, delivered);
  }
  return summary;
}

/** Tenants with a push subscription or an email opt-in, each once. */
export function ownerIdsToVisit(deps: Pick<PushTickDeps, 'config' | 'emailOrigin'>): string[] {
  const ids = new Set<string>();
  if (deps.config) for (const id of listOwnerIdsWithPushSubscriptions()) ids.add(id);
  if (deps.emailOrigin) for (const id of listOwnerIdsWithEmailOptIns()) ids.add(id);
  return [...ids];
}

export async function runPushTick(deps: PushTickDeps): Promise<PushTickSummary> {
  const total: PushTickSummary = {
    owners: 0,
    alerts: 0,
    sent: 0,
    removed: 0,
    failed: 0,
    emailed: 0,
    emailFailed: 0
  };
  for (const ownerId of ownerIdsToVisit(deps)) {
    if (SKIPPED_BILLING.has(ownerRow(ownerId)?.billingStatus ?? '')) continue;
    try {
      const s = await runWithTenantAsync(ownerId, () => processOwnerAlerts(ownerId, deps));
      total.owners++;
      total.alerts += s.alerts;
      total.sent += s.sent;
      total.removed += s.removed;
      total.failed += s.failed;
      total.emailed += s.emailed;
      total.emailFailed += s.emailFailed;
    } catch (err) {
      console.error(`[push] tick failed for owner ${ownerId}`, err);
    }
  }
  return total;
}

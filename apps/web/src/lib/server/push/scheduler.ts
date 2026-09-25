/**
 * NFR-06 — in-process push alert scheduler.
 *
 * CropCard runs as a single replica (CLAUDE.md invariant 3), so a plain
 * interval in the Node process is enough: no queue, no leader election.
 * Every tick visits each Owner that has at least one subscription, builds
 * that Owner's snapshot inside `runWithTenantAsync`, selects due alerts
 * (triggers.ts), and claims each in the `push_deliveries` sent-log before
 * sending, so an alert goes out at most once even across restarts.
 *
 * Disabled entirely when VAPID is unset or under tests; the clock, interval,
 * and fetch are injectable.
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
import {
  claimDelivery,
  listOwnerIdsWithPushSubscriptions,
  listSubscriptions,
  setDeliveryRecipientCount
} from '$lib/db/pushSubscriptions';
import { selectRecipients, sendToSubscriptions } from './dispatch';
import {
  LOCK_WINDOW_MS,
  selectDueAlerts,
  type LockableRecordSnapshot,
  type SprayerSnapshot
} from './triggers';
import { readVapidConfig, type VapidConfig } from './webPush';

export const PUSH_TICK_INTERVAL_MS = 15 * 60 * 1000;

const SKIPPED_BILLING = new Set(['suspended', 'canceled']);

export interface PushTickDeps {
  config: VapidConfig;
  now?: () => number;
  fetchImpl?: typeof fetch;
}

export interface PushTickSummary {
  owners: number;
  alerts: number;
  sent: number;
  removed: number;
  failed: number;
}

function ownerBillingStatus(ownerId: string): string | null {
  unscopedQueryNote('push scheduler checks the global owners row for billing suspension');
  const row = db
    .select({ billingStatus: owners.billingStatus })
    .from(owners)
    .where(eq(owners.id, ownerId))
    .get();
  return row?.billingStatus ?? null;
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
  const blockName = new Map(listBlocks().map((b) => [b.id, b.name]));
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

/** Process one Owner. Caller must already be inside that Owner's tenant context. */
export async function processOwnerAlerts(
  ownerId: string,
  deps: PushTickDeps
): Promise<Omit<PushTickSummary, 'owners'>> {
  const now = (deps.now ?? Date.now)();
  const summary = { alerts: 0, sent: 0, removed: 0, failed: 0 };
  const { sprayers, records } = ownerSnapshot(now);
  const alerts = selectDueAlerts({ sprayers, records, now });
  if (alerts.length === 0) return summary;
  const members = usersForOwner(ownerId);
  for (const alert of alerts) {
    if (!claimDelivery(alert.kind, alert.subjectId, now)) continue;
    summary.alerts++;
    const recipients = selectRecipients(listSubscriptions(), members, alert);
    if (recipients.length === 0) continue;
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
    setDeliveryRecipientCount(alert.kind, alert.subjectId, result.sent);
    summary.sent += result.sent;
    summary.removed += result.removed;
    summary.failed += result.failed;
  }
  return summary;
}

export async function runPushTick(deps: PushTickDeps): Promise<PushTickSummary> {
  const total: PushTickSummary = { owners: 0, alerts: 0, sent: 0, removed: 0, failed: 0 };
  for (const ownerId of listOwnerIdsWithPushSubscriptions()) {
    if (SKIPPED_BILLING.has(ownerBillingStatus(ownerId) ?? '')) continue;
    try {
      const s = await runWithTenantAsync(ownerId, () => processOwnerAlerts(ownerId, deps));
      total.owners++;
      total.alerts += s.alerts;
      total.sent += s.sent;
      total.removed += s.removed;
      total.failed += s.failed;
    } catch (err) {
      console.error(`[push] tick failed for owner ${ownerId}`, err);
    }
  }
  return total;
}

export interface PushSchedulerHandle {
  stop(): void;
  /** Resolves when the in-flight tick (if any) settles. */
  tick(): Promise<PushTickSummary | null>;
}

export function startPushScheduler(
  deps: PushTickDeps & {
    intervalMs?: number;
    setIntervalImpl?: (fn: () => void, ms: number) => unknown;
    clearIntervalImpl?: (handle: unknown) => void;
  }
): PushSchedulerHandle {
  let running: Promise<PushTickSummary | null> | null = null;
  const tick = (): Promise<PushTickSummary | null> => {
    if (running) return running;
    running = runPushTick(deps)
      .catch((err) => {
        console.error('[push] tick failed', err);
        return null;
      })
      .finally(() => {
        running = null;
      });
    return running;
  };
  const setI = deps.setIntervalImpl ?? ((fn, ms) => setInterval(fn, ms));
  const clearI =
    deps.clearIntervalImpl ?? ((h) => clearInterval(h as ReturnType<typeof setInterval>));
  const handle = setI(() => void tick(), deps.intervalMs ?? PUSH_TICK_INTERVAL_MS);
  (handle as { unref?: () => void } | null)?.unref?.();
  return { stop: () => clearI(handle), tick };
}

export function shouldRunPushScheduler(env: Record<string, string | undefined>): boolean {
  if (env.NODE_ENV === 'test' || env.VITEST === 'true') return false;
  if (env.PUSH_SCHEDULER === 'off') return false;
  return readVapidConfig(env) !== null;
}

const GLOBAL_KEY = Symbol.for('cropcard.pushScheduler');

/** Called from hooks.server.ts `init`. Idempotent across HMR reloads. */
export function maybeStartPushScheduler(
  env: Record<string, string | undefined> = process.env
): PushSchedulerHandle | null {
  if (!shouldRunPushScheduler(env)) return null;
  const g = globalThis as Record<symbol, PushSchedulerHandle | undefined>;
  const existing = g[GLOBAL_KEY];
  if (existing) return existing;
  const config = readVapidConfig(env);
  if (!config) return null;
  const handle = startPushScheduler({ config });
  g[GLOBAL_KEY] = handle;
  console.log('[push] scheduler started (every 15 min)');
  return handle;
}

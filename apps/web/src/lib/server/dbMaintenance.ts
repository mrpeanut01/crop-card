/**
 * Daily SQLite upkeep: refresh planner stats and prune operational log
 * tables that would otherwise grow forever.
 *
 * Compliance ledgers are never touched: spray/insecticide/fungicide/harvest
 * events, hay cuttings, stock movements, equipment_log, tasks,
 * record_deletions, superadmin_audit, plan_revisions and wizard chat. Only
 * the tables listed in RETENTION_RULES are pruned, each on its own clock.
 */

import { eq } from 'drizzle-orm';
import { db, sqliteHandle } from '$lib/db/client';
import { systemState } from '$lib/db/schema';
import { unscopedQueryNote } from '$lib/db/tenant';
import { STALE_CLAIM_MS } from '$lib/db/clientRecords';
import { isFenced, trackMutation } from '$lib/server/ops/handoff';

const DAY_MS = 86_400_000;

export const MAINTENANCE_INTERVAL_MS = DAY_MS;
export const LAST_RUN_KEY = 'db_maintenance.last_run_at';
const DEFAULT_BATCH = 500;

export interface RetentionRule {
  name: string;
  table: string;
  /** SQL predicate on the row, with one `?` bound to the cutoff (epoch ms). */
  where: string;
  /** Rows older than this (relative to now) match the predicate. */
  keepMs: number;
  why: string;
}

/** Everything reads at most the last month (quota, caps, /settings/ai,
 *  re-ask-ai lists the latest 200 fallback rows); billing totals live in
 *  owner_usage_counters, so no roll-up is needed before pruning. */
export const RETENTION_RULES: readonly RetentionRule[] = [
  {
    name: 'ai_call_log',
    table: 'ai_call_log',
    where: 'created_at < ?',
    keepMs: 400 * DAY_MS,
    why: 'readers look back at most one month; 13 months kept for support questions'
  },
  {
    name: 'client_record_receipts.done',
    table: 'client_record_receipts',
    where: "status = 'done' AND updated_at < ?",
    keepMs: 180 * DAY_MS,
    why: 'offline replays drain on reconnect; half a year covers any device left offline'
  },
  {
    name: 'client_record_receipts.abandoned',
    table: 'client_record_receipts',
    where: "status = 'pending' AND updated_at < ?",
    keepMs: Math.max(DAY_MS, STALE_CLAIM_MS),
    why: 'a pending claim older than the stale window is re-claimable anyway'
  },
  {
    name: 'push_deliveries',
    table: 'push_deliveries',
    where: 'sent_at < ?',
    keepMs: 400 * DAY_MS,
    why: 'de-dupe subjects are bounded (7-day decon, 48 h lock, per-year calibration)'
  },
  {
    name: 'kernel_dry_run_log',
    table: 'kernel_dry_run_log',
    where: 'created_at < ?',
    keepMs: 180 * DAY_MS,
    why: 'what-would-have-happened verdicts for gate roll-outs; not a compliance record'
  },
  {
    name: 'weather_forecast_cache',
    table: 'weather_forecast_cache',
    where: 'expires_at < ?',
    keepMs: DAY_MS,
    why: 'only rows a day past their own expiry; expired rows are never served'
  }
];

export interface MaintenanceResult {
  ran: boolean;
  skipped?: 'recent' | 'running' | 'fenced';
  pruned: Record<string, number>;
  durationMs: number;
}

export interface MaintenanceOptions {
  now?: number;
  force?: boolean;
  batchSize?: number;
}

function readLastRun(): number | null {
  const row = db.select().from(systemState).where(eq(systemState.key, LAST_RUN_KEY)).get();
  const n = row ? Number(row.value) : NaN;
  return Number.isFinite(n) ? n : null;
}

function writeLastRun(now: number): void {
  db.insert(systemState)
    .values({ key: LAST_RUN_KEY, value: String(now), updatedAt: new Date(now) })
    .onConflictDoUpdate({
      target: systemState.key,
      set: { value: String(now), updatedAt: new Date(now) }
    })
    .run();
}

const yieldToEventLoop = () => new Promise<void>((r) => setImmediate(r));

/** Deletes matching rows in small autocommit batches so the write lock is
 *  held for milliseconds and requests interleave between batches. */
async function pruneRule(rule: RetentionRule, now: number, batch: number): Promise<number> {
  unscopedQueryNote(
    'retention pruning is a deployment-wide job over non-compliance log tables, by age only'
  );
  const cutoff = now - rule.keepMs;
  const stmt = sqliteHandle().prepare(
    `DELETE FROM ${rule.table} WHERE rowid IN (SELECT rowid FROM ${rule.table} WHERE ${rule.where} LIMIT ?)`
  );
  let total = 0;
  for (;;) {
    if (isFenced()) return total;
    const { changes } = stmt.run(cutoff, batch);
    total += changes;
    if (changes < batch) return total;
    await yieldToEventLoop();
  }
}

let running: Promise<MaintenanceResult> | null = null;

async function run(opts: MaintenanceOptions): Promise<MaintenanceResult> {
  const now = opts.now ?? Date.now();
  const started = performance.now();
  if (isFenced()) return { ran: false, skipped: 'fenced', pruned: {}, durationMs: 0 };
  const last = readLastRun();
  if (!opts.force && last !== null && now - last < MAINTENANCE_INTERVAL_MS) {
    return { ran: false, skipped: 'recent', pruned: {}, durationMs: 0 };
  }
  writeLastRun(now);
  const batch = opts.batchSize ?? DEFAULT_BATCH;
  const pruned: Record<string, number> = {};
  for (const rule of RETENTION_RULES) {
    pruned[rule.name] = await pruneRule(rule, now, batch);
    await yieldToEventLoop();
  }
  if (!isFenced()) sqliteHandle().pragma('optimize');
  const durationMs = Math.round(performance.now() - started);
  console.log('[db-maintenance]', JSON.stringify({ pruned, ms: durationMs }));
  return { ran: true, pruned, durationMs };
}

/** Runs at most once per 24 h (tracked in system_state) and never twice
 *  at the same time. Safe to call from boot and from a scheduled wakeup.
 *  Counted as an in-flight write for the deploy handoff fence, and stops
 *  between batches once the fence is up. */
export function runDbMaintenance(opts: MaintenanceOptions = {}): Promise<MaintenanceResult> {
  if (running) {
    return Promise.resolve({ ran: false, skipped: 'running', pruned: {}, durationMs: 0 });
  }
  running = trackMutation(() => run(opts)).finally(() => {
    running = null;
  });
  return running;
}

const BOOT_KEY = Symbol.for('cropcard.dbMaintenanceBoot');

/** Called from hooks.server.ts `init`: one non-blocking run shortly after
 *  boot, so a scale-to-zero replica still gets its daily pass. */
export function scheduleBootMaintenance(
  env: Record<string, string | undefined> = process.env,
  delayMs = 30_000
): boolean {
  if (env.NODE_ENV === 'test' || env.VITEST === 'true' || env.DB_MAINTENANCE === 'off') {
    return false;
  }
  const g = globalThis as Record<symbol, boolean | undefined>;
  if (g[BOOT_KEY]) return false;
  g[BOOT_KEY] = true;
  const t = setTimeout(() => {
    runDbMaintenance().catch((err) => console.error('[db-maintenance] failed', err));
  }, delayMs);
  t.unref?.();
  return true;
}

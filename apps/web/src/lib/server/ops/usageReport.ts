/**
 * Weekly operator usage report: users, sign-ins, farm activity, AI spend and
 * storage, emailed to the addresses in `OPS_REPORT_TO` (Key Vault
 * `ops-report-to`, so the address never sits in this public repo).
 *
 * Sent from the twice-daily push wakeup on Mondays (America/New_York), once
 * per Monday through `system_state`; the evening tick retries a morning that
 * failed. `/admin/usage` shows the same report and can send it on demand.
 * Demo farms and demo visitors are left out of every number except the
 * live-demo count.
 */

import { statSync } from 'node:fs';
import { eq } from 'drizzle-orm';
import { databasePath, db, sqliteHandle } from '$lib/db/client';
import { systemState } from '$lib/db/schema';
import { unscopedQueryNote } from '$lib/db/tenant';
import { DEMO_EMAIL_DOMAIN, DEMO_OWNER_PREFIX } from '$lib/demo/identity';
import { realNow } from '$lib/server/clock';
import { dispatchEmail } from '$lib/server/email';

const DAY_MS = 86_400_000;
export const REPORT_WINDOW_MS = 7 * DAY_MS;
export const REPORT_TIME_ZONE = 'America/New_York';
export const LAST_SENT_KEY = 'ops_report.last_sent_for';

/** Record tables counted as farm activity, each by the column that dates a
 *  new row. A table or column missing from the database is skipped. */
export const ACTIVITY_TABLES: readonly { table: string; label: string; column: string }[] = [
  { table: 'spray_events', label: 'Herbicide sprays', column: 'created_at' },
  { table: 'insecticide_events', label: 'Insecticide sprays', column: 'created_at' },
  { table: 'fungicide_events', label: 'Fungicide sprays', column: 'created_at' },
  { table: 'harvest_events', label: 'Harvests', column: 'created_at' },
  { table: 'hay_cuttings', label: 'Hay cuttings', column: 'created_at' },
  { table: 'scout_observations', label: 'Scouting notes', column: 'created_at' },
  { table: 'fertility_applications', label: 'Fertility applications', column: 'created_at' },
  { table: 'animal_health_events', label: 'Animal treatments', column: 'created_at' },
  { table: 'animal_production_logs', label: 'Animal production logs', column: 'created_at' },
  { table: 'planting_journal', label: 'Journal entries', column: 'created_at' },
  { table: 'crops', label: 'Plantings added', column: 'created_at' },
  { table: 'tasks', label: 'Tasks completed', column: 'completed_at' }
];

export interface StorageFarm {
  name: string;
  bytes: number;
}

export interface UsageReport {
  generatedAt: number;
  windowStart: number;
  windowEnd: number;
  users: {
    total: number;
    new: number;
    newPrevious: number;
    active: number;
    activePrevious: number;
    active30d: number;
    returning: number;
    neverSeen: number;
  };
  signIns: {
    total: number;
    distinctUsers: number;
    byExistingUsers: number;
    byNewUsers: number;
    email: number;
    sms: number;
    previous: number;
  };
  farms: {
    total: number;
    new: number;
    withActivity: number;
    liveDemos: number;
  };
  activity: { label: string; count: number }[];
  ai: { calls: number; fallbacks: number; usd: number; previousUsd: number };
  storage: {
    databaseBytes: number;
    walBytes: number;
    vaultBytes: number;
    inlinePhotoBytes: number;
    appDataBytes: number;
    perUserBytes: number;
    perFarmBytes: number;
    topFarms: StorageFarm[];
  };
}

type Row = Record<string, unknown>;

function num(v: unknown): number {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function hasColumn(table: string, column: string): boolean {
  const cols = sqliteHandle()
    .prepare(`PRAGMA table_info(${JSON.stringify(table)})`)
    .all() as Row[];
  return cols.some((c) => c.name === column);
}

function scalar(sqlText: string, ...params: unknown[]): number {
  const row = sqliteHandle()
    .prepare(sqlText)
    .get(...params) as Row | undefined;
  return num(row ? Object.values(row)[0] : 0);
}

const DEMO_USER_SQL = `(email IS NOT NULL AND email LIKE '%@${DEMO_EMAIL_DOMAIN}')`;
const DEMO_OWNER_LIKE = `${DEMO_OWNER_PREFIX}%`;

function fileBytes(path: string): number {
  try {
    return statSync(path).size;
  } catch {
    return 0;
  }
}

function userCounts(start: number, end: number): UsageReport['users'] {
  unscopedQueryNote('operator usage report counts users across every farm');
  const real = `users WHERE NOT ${DEMO_USER_SQL}`;
  const prevStart = start - REPORT_WINDOW_MS;
  return {
    total: scalar(`SELECT count(*) FROM ${real}`),
    new: scalar(`SELECT count(*) FROM ${real} AND created_at >= ? AND created_at < ?`, start, end),
    newPrevious: scalar(
      `SELECT count(*) FROM ${real} AND created_at >= ? AND created_at < ?`,
      prevStart,
      start
    ),
    active: scalar(
      `SELECT count(*) FROM ${real} AND last_seen_at >= ? AND last_seen_at < ?`,
      start,
      end
    ),
    activePrevious: scalar(
      `SELECT count(*) FROM ${real} AND last_seen_at >= ? AND last_seen_at < ?`,
      prevStart,
      start
    ),
    active30d: scalar(
      `SELECT count(*) FROM ${real} AND last_seen_at >= ? AND last_seen_at < ?`,
      end - 30 * DAY_MS,
      end
    ),
    returning: scalar(
      `SELECT count(*) FROM ${real} AND last_seen_at >= ? AND last_seen_at < ? AND created_at < ?`,
      start,
      end,
      start
    ),
    neverSeen: scalar(`SELECT count(*) FROM ${real} AND last_seen_at IS NULL`)
  };
}

/** A completed sign-in is a consumed email login token (the link, or the
 *  6-digit code, which consumes its token too) or a consumed SMS login
 *  code. Codes that link an address to an account are not sign-ins. */
function signInEvents(
  start: number,
  end: number
): { userId: string | null; createdAt: number; channel: 'email' | 'sms' }[] {
  unscopedQueryNote('operator usage report counts sign-ins across every farm');
  const email = sqliteHandle()
    .prepare(
      `SELECT u.id AS userId, u.created_at AS createdAt
         FROM login_tokens t LEFT JOIN users u ON u.email = t.email
        WHERE t.consumed_at >= ? AND t.consumed_at < ? AND t.email NOT LIKE ?`
    )
    .all(start, end, `%@${DEMO_EMAIL_DOMAIN}`) as Row[];
  const sms = sqliteHandle()
    .prepare(
      `SELECT u.id AS userId, u.created_at AS createdAt
         FROM login_codes c LEFT JOIN users u ON u.id = c.user_id OR (c.user_id IS NULL AND u.phone = c.destination)
        WHERE c.channel = 'sms' AND c.purpose = 'login' AND c.consumed_at >= ? AND c.consumed_at < ?`
    )
    .all(start, end) as Row[];
  return [
    ...email.map((r) => ({
      userId: (r.userId as string) ?? null,
      createdAt: num(r.createdAt),
      channel: 'email' as const
    })),
    ...sms.map((r) => ({
      userId: (r.userId as string) ?? null,
      createdAt: num(r.createdAt),
      channel: 'sms' as const
    }))
  ];
}

function signInCounts(start: number, end: number): UsageReport['signIns'] {
  const events = signInEvents(start, end);
  const distinct = new Set(events.map((e) => e.userId).filter((id): id is string => !!id));
  const byExisting = events.filter((e) => e.userId && e.createdAt < start).length;
  return {
    total: events.length,
    distinctUsers: distinct.size,
    byExistingUsers: byExisting,
    byNewUsers: events.length - byExisting,
    email: events.filter((e) => e.channel === 'email').length,
    sms: events.filter((e) => e.channel === 'sms').length,
    previous: signInEvents(start - REPORT_WINDOW_MS, start).length
  };
}

function activityCounts(
  start: number,
  end: number
): {
  activity: UsageReport['activity'];
  activeOwners: Set<string>;
} {
  unscopedQueryNote('operator usage report counts records across every farm');
  const activeOwners = new Set<string>();
  const activity: UsageReport['activity'] = [];
  for (const t of ACTIVITY_TABLES) {
    if (!hasColumn(t.table, t.column) || !hasColumn(t.table, 'owner_id')) continue;
    const rows = sqliteHandle()
      .prepare(
        `SELECT owner_id AS ownerId, count(*) AS n FROM ${t.table}
          WHERE ${t.column} >= ? AND ${t.column} < ? AND owner_id NOT LIKE ?
          GROUP BY owner_id`
      )
      .all(start, end, DEMO_OWNER_LIKE) as Row[];
    let count = 0;
    for (const r of rows) {
      count += num(r.n);
      activeOwners.add(String(r.ownerId));
    }
    activity.push({ label: t.label, count });
  }
  return { activity, activeOwners };
}

function aiCounts(start: number, end: number): UsageReport['ai'] {
  unscopedQueryNote('operator usage report sums AI calls across every farm');
  const where = `created_at >= ? AND created_at < ? AND owner_id NOT LIKE ?`;
  return {
    calls: scalar(
      `SELECT count(*) FROM ai_call_log WHERE ${where} AND (provenance IS NULL OR provenance = 'ai')`,
      start,
      end,
      DEMO_OWNER_LIKE
    ),
    fallbacks: scalar(
      `SELECT count(*) FROM ai_call_log WHERE ${where} AND provenance = 'fallback'`,
      start,
      end,
      DEMO_OWNER_LIKE
    ),
    usd: scalar(
      `SELECT coalesce(sum(usd_estimate), 0) FROM ai_call_log WHERE ${where}`,
      start,
      end,
      DEMO_OWNER_LIKE
    ),
    previousUsd: scalar(
      `SELECT coalesce(sum(usd_estimate), 0) FROM ai_call_log WHERE ${where}`,
      start - REPORT_WINDOW_MS,
      start,
      DEMO_OWNER_LIKE
    )
  };
}

function storageCounts(realUsers: number, realFarms: number): UsageReport['storage'] {
  unscopedQueryNote('operator usage report sums stored bytes across every farm');
  const sqlite = sqliteHandle();
  const pageCount = num((sqlite.pragma('page_count', { simple: true }) as number) ?? 0);
  const pageSize = num((sqlite.pragma('page_size', { simple: true }) as number) ?? 0);
  const path = databasePath();
  const perOwner = new Map<string, number>();
  const add = (rows: Row[]) => {
    for (const r of rows) {
      const id = String(r.ownerId);
      perOwner.set(id, (perOwner.get(id) ?? 0) + num(r.bytes));
    }
  };
  const vaultRows = sqlite
    .prepare(
      `SELECT owner_id AS ownerId, coalesce(sum(byte_size), 0) AS bytes FROM documents
        WHERE deleted_at IS NULL AND owner_id NOT LIKE ? GROUP BY owner_id`
    )
    .all(DEMO_OWNER_LIKE) as Row[];
  const inlineRows = [
    ...(sqlite
      .prepare(
        `SELECT owner_id AS ownerId, coalesce(sum(CASE WHEN photo_ref LIKE 'data:%' THEN length(photo_ref) ELSE 0 END), 0) AS bytes
           FROM planting_journal WHERE owner_id NOT LIKE ? GROUP BY owner_id`
      )
      .all(DEMO_OWNER_LIKE) as Row[]),
    ...(sqlite
      .prepare(
        `SELECT owner_id AS ownerId, coalesce(sum(CASE WHEN photo_ref LIKE 'data:%' THEN length(photo_ref) ELSE 0 END), 0) AS bytes
           FROM animals WHERE owner_id NOT LIKE ? GROUP BY owner_id`
      )
      .all(DEMO_OWNER_LIKE) as Row[])
  ];
  add(vaultRows);
  add(inlineRows);
  const vaultBytes = vaultRows.reduce((s, r) => s + num(r.bytes), 0);
  const inlinePhotoBytes = inlineRows.reduce((s, r) => s + num(r.bytes), 0);
  const databaseBytes = pageCount * pageSize;
  const walBytes = fileBytes(`${path}-wal`);
  const appDataBytes = databaseBytes + vaultBytes;
  const names = new Map(
    (
      sqlite
        .prepare(`SELECT id, name FROM owners WHERE id NOT LIKE ?`)
        .all(DEMO_OWNER_LIKE) as Row[]
    ).map((r) => [String(r.id), String(r.name)] as const)
  );
  const topFarms = [...perOwner.entries()]
    .filter(([, bytes]) => bytes > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([id, bytes]) => ({ name: names.get(id) ?? id, bytes }));
  return {
    databaseBytes,
    walBytes,
    vaultBytes,
    inlinePhotoBytes,
    appDataBytes,
    perUserBytes: realUsers > 0 ? Math.round(appDataBytes / realUsers) : 0,
    perFarmBytes: realFarms > 0 ? Math.round(appDataBytes / realFarms) : 0,
    topFarms
  };
}

export function buildUsageReport(now = realNow()): UsageReport {
  unscopedQueryNote('operator usage report reads every farm');
  const start = now - REPORT_WINDOW_MS;
  const users = userCounts(start, now);
  const { activity, activeOwners } = activityCounts(start, now);
  const farmsTotal = scalar(`SELECT count(*) FROM owners WHERE id NOT LIKE ?`, DEMO_OWNER_LIKE);
  return {
    generatedAt: now,
    windowStart: start,
    windowEnd: now,
    users,
    signIns: signInCounts(start, now),
    farms: {
      total: farmsTotal,
      new: scalar(
        `SELECT count(*) FROM owners WHERE id NOT LIKE ? AND created_at >= ? AND created_at < ?`,
        DEMO_OWNER_LIKE,
        start,
        now
      ),
      withActivity: activeOwners.size,
      liveDemos: scalar(`SELECT count(*) FROM owners WHERE id LIKE ?`, DEMO_OWNER_LIKE)
    },
    activity,
    ai: aiCounts(start, now),
    storage: storageCounts(users.total, farmsTotal)
  };
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let v = bytes / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v >= 100 ? v.toFixed(0) : v.toFixed(1)} ${units[i]}`;
}

function delta(now: number, before: number): string {
  const d = now - before;
  if (d === 0) return 'same as the week before';
  return `${d > 0 ? 'up' : 'down'} ${Math.abs(d)} from ${before} the week before`;
}

function usd(v: number): string {
  return `$${v.toFixed(2)}`;
}

export function formatDay(ms: number): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: REPORT_TIME_ZONE,
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric'
  }).format(ms);
}

export function usageReportSubject(r: UsageReport): string {
  return `CropCard usage, week ending ${formatDay(r.windowEnd)}`;
}

export function usageReportText(r: UsageReport): string {
  const s = r.storage;
  const lines = [
    `CropCard usage for ${formatDay(r.windowStart)} to ${formatDay(r.windowEnd)} (Eastern Time).`,
    `Demo farms and demo visitors are left out of every number below except the live demo count.`,
    ``,
    `USERS`,
    `Total accounts: ${r.users.total}`,
    `New accounts this week: ${r.users.new} (${delta(r.users.new, r.users.newPrevious)})`,
    `Active this week: ${r.users.active} (${delta(r.users.active, r.users.activePrevious)})`,
    `Returning users active this week (signed up before it): ${r.users.returning}`,
    `Active in the last 30 days: ${r.users.active30d}`,
    `Not seen since activity tracking began: ${r.users.neverSeen}`,
    ``,
    `SIGN-INS`,
    `Completed sign-ins: ${r.signIns.total} (${delta(r.signIns.total, r.signIns.previous)})`,
    `By existing users: ${r.signIns.byExistingUsers}; by new users: ${r.signIns.byNewUsers}`,
    `Distinct people signing in: ${r.signIns.distinctUsers}`,
    `By email: ${r.signIns.email}; by text message: ${r.signIns.sms}`,
    `Sessions last 7 days, so a person who stays signed in shows as active without a new sign-in.`,
    ``,
    `FARMS`,
    `Total farms: ${r.farms.total}`,
    `New farms this week: ${r.farms.new}`,
    `Farms that recorded anything this week: ${r.farms.withActivity}`,
    `Demo farms live right now: ${r.farms.liveDemos}`,
    ``,
    `ACTIVITY THIS WEEK`,
    ...r.activity.map((a) => `${a.label}: ${a.count}`),
    ``,
    `AI`,
    `Claude calls: ${r.ai.calls}; fallbacks without Claude: ${r.ai.fallbacks}`,
    `Estimated AI spend: ${usd(r.ai.usd)} (week before: ${usd(r.ai.previousUsd)})`,
    ``,
    `STORAGE`,
    `Database: ${formatBytes(s.databaseBytes)} (write-ahead log ${formatBytes(s.walBytes)})`,
    `Document vault (photos and files): ${formatBytes(s.vaultBytes)}`,
    `Photos still stored inside the database: ${formatBytes(s.inlinePhotoBytes)}`,
    `App data in total: ${formatBytes(s.appDataBytes)}`,
    `Average per user: ${formatBytes(s.perUserBytes)}; average per farm: ${formatBytes(s.perFarmBytes)}`,
    ...(s.topFarms.length > 0
      ? [
          `Largest farms by files and photos:`,
          ...s.topFarms.map((f) => `  ${f.name}: ${formatBytes(f.bytes)}`)
        ]
      : []),
    ``,
    `App data is what the app itself holds. The Azure storage bill also covers Litestream`,
    `snapshots and WAL segments, previous blob versions, soft-deleted blobs and geo-redundant`,
    `copies, so compare this total with Cost Management before changing retention.`
  ];
  return lines.join('\n');
}

export function readReportRecipients(
  env: Record<string, string | undefined> = process.env
): string[] {
  return (env.OPS_REPORT_TO ?? '')
    .split(/[,;\s]+/)
    .map((s) => s.trim())
    .filter((s) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s));
}

/** The Monday (YYYY-MM-DD, Eastern Time) a report is due for, or null on any
 *  other day. */
export function reportDueFor(now: number): string | null {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: REPORT_TIME_ZONE,
    weekday: 'short',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  if (get('weekday') !== 'Mon') return null;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

export async function sendUsageReport(
  recipients: string[],
  report: UsageReport = buildUsageReport()
): Promise<number> {
  const subject = usageReportSubject(report);
  const body = usageReportText(report);
  for (const to of recipients) {
    await dispatchEmail({ kind: 'ops-report', to, subject, body });
  }
  return recipients.length;
}

export type WeeklyReportResult =
  | { sent: number; dueFor: string }
  | { skipped: 'no-recipients' | 'not-monday' | 'already-sent' }
  | { failed: true };

/** Called from every push wakeup; sends at most once per Monday. */
export async function runWeeklyUsageReport(
  deps: { now?: number; env?: Record<string, string | undefined> } = {}
): Promise<WeeklyReportResult> {
  const now = deps.now ?? realNow();
  const recipients = readReportRecipients(deps.env ?? process.env);
  if (recipients.length === 0) return { skipped: 'no-recipients' };
  const dueFor = reportDueFor(now);
  if (!dueFor) return { skipped: 'not-monday' };
  const last = db.select().from(systemState).where(eq(systemState.key, LAST_SENT_KEY)).get();
  if (last?.value === dueFor) return { skipped: 'already-sent' };
  try {
    const sent = await sendUsageReport(recipients, buildUsageReport(now));
    db.insert(systemState)
      .values({ key: LAST_SENT_KEY, value: dueFor, updatedAt: new Date(now) })
      .onConflictDoUpdate({
        target: systemState.key,
        set: { value: dueFor, updatedAt: new Date(now) }
      })
      .run();
    return { sent, dueFor };
  } catch (err) {
    console.error('[ops-report] failed', err);
    return { failed: true };
  }
}

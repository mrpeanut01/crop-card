// @vitest-environment node
import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { sqliteHandle } from '$lib/db/client';
import { clearOutbox, readOutbox } from '$lib/server/email';
import { _fenceForTests, _resetHandoffForTests } from '$lib/server/ops/handoff';
import { lastSeenIsStale, LAST_SEEN_INTERVAL_MS, touchLastSeen } from './lastSeen';
import {
  buildUsageReport,
  formatBytes,
  LAST_SENT_KEY,
  readReportRecipients,
  reportDueFor,
  runWeeklyUsageReport,
  usageReportText
} from './usageReport';

const DAY = 86_400_000;
/** Monday 2040-01-09 15:00 UTC (10:00 Eastern). */
const NOW = Date.UTC(2040, 0, 9, 15);
const IN_WEEK = NOW - 2 * DAY;
const LAST_WEEK = NOW - 9 * DAY;
const LONG_AGO = NOW - 200 * DAY;
const tag = randomUUID().slice(0, 8);

function addUser(id: string, email: string, createdAt: number, lastSeenAt: number | null) {
  sqliteHandle()
    .prepare('INSERT INTO users (id, email, created_at, last_seen_at) VALUES (?, ?, ?, ?)')
    .run(id, email, createdAt, lastSeenAt);
}

function addOwner(id: string, name: string, createdAt: number) {
  sqliteHandle()
    .prepare('INSERT INTO owners (id, name, slug, created_at) VALUES (?, ?, ?, ?)')
    .run(id, name, `${id}-slug`, createdAt);
}

function addSignIn(email: string, consumedAt: number) {
  sqliteHandle()
    .prepare(
      `INSERT INTO login_tokens (id, token_hash, email, created_at, expires_at, consumed_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(randomUUID(), randomUUID(), email, consumedAt - 60_000, consumedAt + 60_000, consumedAt);
}

function addDocument(ownerId: string, bytes: number, deleted = false) {
  sqliteHandle()
    .prepare(
      `INSERT INTO documents (id, owner_id, kind, title, mime, byte_size, sha256, crc32, storage_key, created_at, deleted_at)
       VALUES (?, ?, 'other', 't', 'application/pdf', ?, 'x', 0, ?, ?, ?)`
    )
    .run(randomUUID(), ownerId, bytes, randomUUID(), IN_WEEK, deleted ? IN_WEEK : null);
}

describe('buildUsageReport', () => {
  const before = buildUsageReport(NOW);

  addUser(`u-old-${tag}`, `old-${tag}@example.com`, LONG_AGO, IN_WEEK);
  addUser(`u-new-${tag}`, `new-${tag}@example.com`, IN_WEEK, IN_WEEK);
  addUser(`u-prev-${tag}`, `prev-${tag}@example.com`, LAST_WEEK, LAST_WEEK);
  addUser(`u-demo-${tag}`, `visitor-${tag}@demo.cropcard.invalid`, IN_WEEK, IN_WEEK);
  addOwner(`farm-big-${tag}`, `Big Farm ${tag}`, LONG_AGO);
  addOwner(`farm-new-${tag}`, `New Farm ${tag}`, IN_WEEK);
  addOwner(`owner_demo_${tag}`, 'Willow Run Farm', IN_WEEK);
  addSignIn(`old-${tag}@example.com`, IN_WEEK);
  addSignIn(`old-${tag}@example.com`, IN_WEEK + 1000);
  addSignIn(`new-${tag}@example.com`, IN_WEEK);
  addSignIn(`prev-${tag}@example.com`, LAST_WEEK);
  addSignIn(`visitor-${tag}@demo.cropcard.invalid`, IN_WEEK);
  addDocument(`farm-big-${tag}`, 5_000_000);
  addDocument(`farm-big-${tag}`, 9_000_000, true);
  addDocument(`farm-new-${tag}`, 1_000_000);
  addDocument(`owner_demo_${tag}`, 50_000_000);

  const r = buildUsageReport(NOW);

  it('counts new, active and returning users, leaving demo visitors out', () => {
    expect(r.users.total - before.users.total).toBe(3);
    expect(r.users.new - before.users.new).toBe(1);
    expect(r.users.newPrevious - before.users.newPrevious).toBe(1);
    expect(r.users.active - before.users.active).toBe(2);
    expect(r.users.returning - before.users.returning).toBe(1);
  });

  it('splits sign-ins between existing and new users', () => {
    expect(r.signIns.total - before.signIns.total).toBe(3);
    expect(r.signIns.byExistingUsers - before.signIns.byExistingUsers).toBe(2);
    expect(r.signIns.byNewUsers - before.signIns.byNewUsers).toBe(1);
    expect(r.signIns.distinctUsers - before.signIns.distinctUsers).toBe(2);
    expect(r.signIns.previous - before.signIns.previous).toBe(1);
  });

  it('counts farms and live demos separately', () => {
    expect(r.farms.total - before.farms.total).toBe(2);
    expect(r.farms.new - before.farms.new).toBe(1);
    expect(r.farms.liveDemos - before.farms.liveDemos).toBe(1);
  });

  it('sums live vault bytes, ranks the largest farms and averages per user and farm', () => {
    expect(r.storage.vaultBytes - before.storage.vaultBytes).toBe(6_000_000);
    expect(r.storage.topFarms[0]).toEqual({ name: `Big Farm ${tag}`, bytes: 5_000_000 });
    expect(r.storage.topFarms.some((f) => f.name === 'Willow Run Farm')).toBe(false);
    expect(r.storage.databaseBytes).toBeGreaterThan(0);
    expect(r.storage.perUserBytes).toBe(Math.round(r.storage.appDataBytes / r.users.total));
    expect(r.storage.perFarmBytes).toBe(Math.round(r.storage.appDataBytes / r.farms.total));
  });

  it('renders every section as plain text', () => {
    const text = usageReportText(r);
    for (const h of ['USERS', 'SIGN-INS', 'FARMS', 'ACTIVITY THIS WEEK', 'AI', 'STORAGE']) {
      expect(text).toContain(`\n${h}\n`);
    }
    expect(text).toContain(`Big Farm ${tag}: 4.8 MB`);
  });
});

describe('weekly schedule', () => {
  const transport = process.env.EMAIL_TRANSPORT;
  afterEach(() => {
    if (transport === undefined) delete process.env.EMAIL_TRANSPORT;
    else process.env.EMAIL_TRANSPORT = transport;
  });
  beforeEach(() => {
    clearOutbox();
    sqliteHandle().prepare('DELETE FROM system_state WHERE key = ?').run(LAST_SENT_KEY);
  });

  it('is due only on Mondays in Eastern Time', () => {
    expect(reportDueFor(NOW)).toBe('2040-01-09');
    expect(reportDueFor(Date.UTC(2040, 0, 9, 3))).toBeNull();
    expect(reportDueFor(Date.UTC(2040, 0, 10, 15))).toBeNull();
  });

  it('reads comma or space separated recipients and drops anything that is not an address', () => {
    expect(readReportRecipients({ OPS_REPORT_TO: 'a@x.io, b@y.org;nope' })).toEqual([
      'a@x.io',
      'b@y.org'
    ]);
    expect(readReportRecipients({})).toEqual([]);
  });

  it('sends once per Monday and skips without recipients', async () => {
    const env = { OPS_REPORT_TO: 'ops@example.com' };
    process.env.EMAIL_TRANSPORT = 'memory';
    expect(await runWeeklyUsageReport({ now: NOW, env: {} })).toEqual({ skipped: 'no-recipients' });
    expect(await runWeeklyUsageReport({ now: NOW + DAY, env })).toEqual({ skipped: 'not-monday' });
    expect(await runWeeklyUsageReport({ now: NOW, env })).toEqual({
      sent: 1,
      dueFor: '2040-01-09'
    });
    expect(await runWeeklyUsageReport({ now: NOW + 3_600_000, env })).toEqual({
      skipped: 'already-sent'
    });
    const mail = readOutbox('ops@example.com');
    expect(mail).toHaveLength(1);
    expect(mail[0].subject).toContain('CropCard usage, week ending Mon, Jan 9, 2040');
    expect(mail[0].body).toContain('STORAGE');
  });
});

describe('touchLastSeen', () => {
  afterEach(() => _resetHandoffForTests());

  it('writes at most once an hour and never while fenced', () => {
    const id = `u-seen-${tag}`;
    addUser(id, `seen-${tag}@example.com`, LONG_AGO, null);
    expect(lastSeenIsStale(null, NOW)).toBe(true);
    expect(lastSeenIsStale(new Date(NOW - LAST_SEEN_INTERVAL_MS + 1), NOW)).toBe(false);
    expect(touchLastSeen(id, null, NOW)).toBe(true);
    expect(touchLastSeen(id, new Date(NOW), NOW + 1000)).toBe(false);
    _fenceForTests();
    expect(touchLastSeen(id, new Date(NOW), NOW + LAST_SEEN_INTERVAL_MS)).toBe(false);
    const row = sqliteHandle()
      .prepare('SELECT last_seen_at AS t FROM users WHERE id = ?')
      .get(id) as {
      t: number;
    };
    expect(row.t).toBe(NOW);
  });
});

describe('formatBytes', () => {
  it('uses binary units', () => {
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(1536)).toBe('1.5 KB');
    expect(formatBytes(5 * 1024 ** 3)).toBe('5.0 GB');
  });
});

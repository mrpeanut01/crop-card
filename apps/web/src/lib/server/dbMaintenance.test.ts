/**
 * Retention pruning: each rule deletes only its own table's rows past their
 * own clock, and compliance ledgers are never touched. Runs with `now` set
 * in 2001 so rows other test files write (dated today) are out of reach.
 */

import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { sqliteHandle } from '$lib/db/client';
import { _fenceForTests, _resetHandoffForTests } from '$lib/server/ops/handoff';
import {
  LAST_RUN_KEY,
  MAINTENANCE_INTERVAL_MS,
  RETENTION_RULES,
  runDbMaintenance
} from './dbMaintenance';

const DAY = 86_400_000;
const NOW = Date.UTC(2001, 5, 1);
const OWNER = `maint-owner-${randomUUID().slice(0, 8)}`;

const COMPLIANCE_LEDGERS = [
  'spray_events',
  'insecticide_events',
  'fungicide_events',
  'harvest_events',
  'hay_cuttings',
  'stock_movements',
  'equipment_log',
  'tasks',
  'record_deletions',
  'superadmin_audit',
  'plan_revisions',
  'wizard_chat_messages',
  'scout_observations',
  'fertility_applications',
  'season_closeouts'
];

const sqlite = () => sqliteHandle();
const exists = (table: string, col: string, id: string) =>
  !!sqlite().prepare(`SELECT 1 FROM ${table} WHERE ${col} = ?`).get(id);

function seedOwner() {
  sqlite()
    .prepare(
      "INSERT OR IGNORE INTO owners (id, name, slug, billing_status) VALUES (?, ?, ?, 'active')"
    )
    .run(OWNER, OWNER, OWNER);
}

function aiRow(at: number): string {
  const id = randomUUID();
  sqlite()
    .prepare(
      "INSERT INTO ai_call_log (id, owner_id, endpoint, model, created_at) VALUES (?, ?, 'inputs', 'm', ?)"
    )
    .run(id, OWNER, at);
  return id;
}

function receipt(status: 'done' | 'pending', at: number): string {
  const id = `r-${randomUUID()}`;
  sqlite()
    .prepare(
      "INSERT INTO client_record_receipts (owner_id, client_record_id, endpoint, status, updated_at) VALUES (?, ?, '/api/x', ?, ?)"
    )
    .run(OWNER, id, status, at);
  return id;
}

function delivery(at: number): string {
  const id = randomUUID();
  sqlite()
    .prepare(
      "INSERT INTO push_deliveries (id, owner_id, kind, subject_id, sent_at) VALUES (?, ?, 'decon-due', ?, ?)"
    )
    .run(id, OWNER, id, at);
  return id;
}

function dryRun(at: number): string {
  const id = randomUUID();
  sqlite()
    .prepare(
      "INSERT INTO kernel_dry_run_log (id, owner_id, rules_version, evaluator, verdict, reasons_json, planned_spray_json, created_at) VALUES (?, ?, 'x', 'fracRotation', 'ok', '[]', '{}', ?)"
    )
    .run(id, OWNER, at);
  return id;
}

function weather(expiresAt: number): string {
  const id = randomUUID();
  sqlite()
    .prepare(
      "INSERT INTO weather_forecast_cache (id, cache_key, fetched_at, expires_at, payload_json) VALUES (?, ?, ?, ?, '[]')"
    )
    .run(id, `maint:${id}`, expiresAt - DAY, expiresAt);
  return id;
}

afterEach(() => {
  sqlite().prepare('DELETE FROM system_state WHERE key = ?').run(LAST_RUN_KEY);
});

describe('RETENTION_RULES', () => {
  it('never names a compliance ledger', () => {
    for (const rule of RETENTION_RULES) {
      expect(COMPLIANCE_LEDGERS).not.toContain(rule.table);
    }
  });

  it('keeps AI history longer than any reader looks back (13 months)', () => {
    const rule = RETENTION_RULES.find((r) => r.table === 'ai_call_log')!;
    expect(rule.keepMs).toBeGreaterThanOrEqual(395 * DAY);
  });
});

describe('runDbMaintenance', () => {
  it('prunes each log table past its own clock and keeps everything newer', async () => {
    seedOwner();
    const oldAi = aiRow(NOW - 401 * DAY);
    const newAi = aiRow(NOW - 399 * DAY);
    const oldDone = receipt('done', NOW - 181 * DAY);
    const recentDone = receipt('done', NOW - 30 * DAY);
    const abandoned = receipt('pending', NOW - 2 * DAY);
    const inFlight = receipt('pending', NOW - 10_000);
    const oldPush = delivery(NOW - 401 * DAY);
    const newPush = delivery(NOW - 10 * DAY);
    const oldDry = dryRun(NOW - 181 * DAY);
    const newDry = dryRun(NOW - 179 * DAY);
    const longExpired = weather(NOW - 2 * DAY);
    const justExpired = weather(NOW - 3_600_000);
    const closedMonth = weather(NOW + 29 * DAY);

    const res = await runDbMaintenance({ now: NOW, force: true });
    expect(res.ran).toBe(true);

    expect(exists('ai_call_log', 'id', oldAi)).toBe(false);
    expect(exists('ai_call_log', 'id', newAi)).toBe(true);
    expect(exists('client_record_receipts', 'client_record_id', oldDone)).toBe(false);
    expect(exists('client_record_receipts', 'client_record_id', recentDone)).toBe(true);
    expect(exists('client_record_receipts', 'client_record_id', abandoned)).toBe(false);
    expect(exists('client_record_receipts', 'client_record_id', inFlight)).toBe(true);
    expect(exists('push_deliveries', 'id', oldPush)).toBe(false);
    expect(exists('push_deliveries', 'id', newPush)).toBe(true);
    expect(exists('kernel_dry_run_log', 'id', oldDry)).toBe(false);
    expect(exists('kernel_dry_run_log', 'id', newDry)).toBe(true);
    expect(exists('weather_forecast_cache', 'id', longExpired)).toBe(false);
    expect(exists('weather_forecast_cache', 'id', justExpired)).toBe(true);
    expect(exists('weather_forecast_cache', 'id', closedMonth)).toBe(true);
  });

  it('never touches compliance ledgers, however old', async () => {
    seedOwner();
    const ancient = NOW - 20 * 365 * DAY;
    const taskId = randomUUID();
    const delId = randomUUID();
    sqlite()
      .prepare(
        "INSERT INTO tasks (id, owner_id, title, kind, scheduled_for, created_at, completed_at) VALUES (?, ?, 't', 'primary', ?, ?, ?)"
      )
      .run(taskId, OWNER, ancient, ancient, ancient);
    sqlite()
      .prepare(
        "INSERT INTO record_deletions (id, owner_id, record_kind, record_id, deleted_at, snapshot_json) VALUES (?, ?, 'spray', 'x', ?, '{}')"
      )
      .run(delId, OWNER, ancient);

    await runDbMaintenance({ now: NOW, force: true });

    expect(exists('tasks', 'id', taskId)).toBe(true);
    expect(exists('record_deletions', 'id', delId)).toBe(true);
  });

  it('deletes in batches until the backlog is gone', async () => {
    seedOwner();
    const ids = Array.from({ length: 7 }, () => aiRow(NOW - 500 * DAY));
    const res = await runDbMaintenance({ now: NOW, force: true, batchSize: 2 });
    expect(res.pruned.ai_call_log).toBeGreaterThanOrEqual(7);
    for (const id of ids) expect(exists('ai_call_log', 'id', id)).toBe(false);
  });

  it('runs at most once per 24 h unless forced', async () => {
    const first = await runDbMaintenance({ now: NOW });
    expect(first.ran).toBe(true);
    const again = await runDbMaintenance({ now: NOW + MAINTENANCE_INTERVAL_MS - 1 });
    expect(again).toMatchObject({ ran: false, skipped: 'recent' });
    const nextDay = await runDbMaintenance({ now: NOW + MAINTENANCE_INTERVAL_MS });
    expect(nextDay.ran).toBe(true);
  });

  it('does nothing once the deploy handoff fence is up', async () => {
    seedOwner();
    const old = aiRow(NOW - 500 * DAY);
    _fenceForTests();
    try {
      const res = await runDbMaintenance({ now: NOW, force: true });
      expect(res).toMatchObject({ ran: false, skipped: 'fenced' });
      expect(exists('ai_call_log', 'id', old)).toBe(true);
    } finally {
      _resetHandoffForTests();
    }
  });

  it('a concurrent call while one is running is skipped, not doubled', async () => {
    const a = runDbMaintenance({ now: NOW, force: true });
    const b = await runDbMaintenance({ now: NOW, force: true });
    expect(b).toMatchObject({ ran: false, skipped: 'running' });
    expect((await a).ran).toBe(true);
  });
});

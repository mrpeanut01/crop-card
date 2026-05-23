/**
 * Append-only audit log writer. Every mutation in the marketplace
 * (uploads, approvals, revocations, admin sign-ins) writes one row.
 */

import { randomBytes } from 'node:crypto';
import { desc } from 'drizzle-orm';
import { getDb } from '$lib/db';
import { auditLog } from '$lib/db/schema';

export type ActorType = 'app' | 'admin' | 'system';

export interface AuditEvent {
  actorType: ActorType;
  actorId: string | null;
  action: string;
  targetTable?: string;
  targetId?: string;
  payload?: unknown;
}

export function audit(ev: AuditEvent): void {
  try {
    getDb()
      .insert(auditLog)
      .values({
        id: `aud_${Date.now()}_${randomBytes(4).toString('hex')}`,
        actorType: ev.actorType,
        actorId: ev.actorId,
        action: ev.action,
        targetTable: ev.targetTable ?? null,
        targetId: ev.targetId ?? null,
        payload: ev.payload ? JSON.stringify(ev.payload) : null,
        createdAt: new Date()
      })
      .run();
  } catch (err) {
    console.error('[audit] write failed', err, ev);
  }
}

export interface AuditRow {
  id: string;
  actorType: ActorType;
  actorId: string | null;
  action: string;
  targetTable: string | null;
  targetId: string | null;
  payload: unknown;
  createdAt: number;
}

export function listAudit(limit = 100): AuditRow[] {
  return getDb()
    .select()
    .from(auditLog)
    .orderBy(desc(auditLog.createdAt))
    .limit(limit)
    .all()
    .map((row) => ({
      id: row.id,
      actorType: row.actorType,
      actorId: row.actorId,
      action: row.action,
      targetTable: row.targetTable,
      targetId: row.targetId,
      payload: row.payload ? safeParse(row.payload) : null,
      createdAt: row.createdAt.getTime()
    }));
}

function safeParse(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return s;
  }
}

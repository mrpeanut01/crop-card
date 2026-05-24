/**
 * Phase 25d (#89) — wizard chat server-persistence repo.
 *
 * Pre-#89 the AllocationWizard kept chat transcripts in $state. Reload
 * lost them; cross-tab planning was impossible. This repo backs the
 * `wizard_sessions` + `wizard_chat_messages` tables so chat survives
 * reloads and can later anchor the ProvenancePanel chain (each AI-
 * refinement revision links back to the chat that produced it).
 *
 * Tenant-scoped per CLAUDE.md invariant 6 — all reads/writes funnel
 * through `withTenant` / `tenantValues`. The cross-tenant property test
 * extension is part of the same commit.
 */

import { randomUUID } from 'node:crypto';
import { and, asc, eq } from 'drizzle-orm';
import { db } from './client';
import { wizardChatMessages, wizardSessions } from './schema';
import { tenantValues, withTenant } from './tenant';

export type WizardStep = 'allocation' | 'schedule' | 'inputs';
export type WizardSessionStatus = 'active' | 'completed' | 'abandoned';
export type WizardChatRole = 'user' | 'assistant' | 'system';

export interface WizardSession {
  id: string;
  ownerId: string;
  planId: string;
  status: WizardSessionStatus;
  createdByUserId: string | null;
  createdAt: number;
  lastActiveAt: number;
  completedAt: number | null;
}

export interface WizardChatMessage {
  id: string;
  ownerId: string;
  sessionId: string;
  step: WizardStep;
  role: WizardChatRole;
  content: string;
  createdAt: number;
}

function sessionRowToDomain(row: typeof wizardSessions.$inferSelect): WizardSession {
  return {
    id: row.id,
    ownerId: row.ownerId,
    planId: row.planId,
    status: row.status as WizardSessionStatus,
    createdByUserId: row.createdByUserId,
    createdAt: row.createdAt.getTime(),
    lastActiveAt: row.lastActiveAt.getTime(),
    completedAt: row.completedAt ? row.completedAt.getTime() : null
  };
}

function messageRowToDomain(row: typeof wizardChatMessages.$inferSelect): WizardChatMessage {
  return {
    id: row.id,
    ownerId: row.ownerId,
    sessionId: row.sessionId,
    step: row.step as WizardStep,
    role: row.role as WizardChatRole,
    content: row.content,
    createdAt: row.createdAt.getTime()
  };
}

export function getActiveSession(planId: string): WizardSession | null {
  const row = db
    .select()
    .from(wizardSessions)
    .where(
      withTenant(
        wizardSessions,
        and(eq(wizardSessions.planId, planId), eq(wizardSessions.status, 'active'))
      )
    )
    .orderBy(asc(wizardSessions.createdAt))
    .limit(1)
    .get();
  return row ? sessionRowToDomain(row) : null;
}

export function getOrCreateActiveSession(
  planId: string,
  createdByUserId?: string
): WizardSession {
  const existing = getActiveSession(planId);
  if (existing) return existing;
  const row = db
    .insert(wizardSessions)
    .values(
      tenantValues({
        id: randomUUID(),
        planId,
        status: 'active',
        createdByUserId: createdByUserId ?? null
      })
    )
    .returning()
    .get();
  return sessionRowToDomain(row);
}

export function listMessages(sessionId: string, step?: WizardStep): WizardChatMessage[] {
  const conds = [eq(wizardChatMessages.sessionId, sessionId)];
  if (step) conds.push(eq(wizardChatMessages.step, step));
  return db
    .select()
    .from(wizardChatMessages)
    .where(withTenant(wizardChatMessages, and(...conds)))
    .orderBy(asc(wizardChatMessages.createdAt))
    .all()
    .map(messageRowToDomain);
}

export interface AppendMessageInput {
  sessionId: string;
  step: WizardStep;
  role: WizardChatRole;
  content: string;
}

export function appendMessage(input: AppendMessageInput): WizardChatMessage {
  const row = db
    .insert(wizardChatMessages)
    .values(
      tenantValues({
        id: randomUUID(),
        sessionId: input.sessionId,
        step: input.step,
        role: input.role,
        content: input.content
      })
    )
    .returning()
    .get();
  // Bump lastActiveAt on the parent session so the loader picks the
  // freshest active session when more than one exists for the planId.
  db.update(wizardSessions)
    .set({ lastActiveAt: new Date() })
    .where(withTenant(wizardSessions, eq(wizardSessions.id, input.sessionId)))
    .run();
  return messageRowToDomain(row);
}

export function markSessionCompleted(sessionId: string): void {
  db.update(wizardSessions)
    .set({ status: 'completed', completedAt: new Date() })
    .where(withTenant(wizardSessions, eq(wizardSessions.id, sessionId)))
    .run();
}

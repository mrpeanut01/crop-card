/**
 * Phase 17 (Track 3.4) — cross-endpoint conversation threading for AI
 * planning. Behind the `CROPCARD_AI_THREAD` feature flag.
 *
 * Today every endpoint (`suggest`, `optimize`, `allocate`, `groups`)
 * sends its own one-shot prompt; Claude has no memory that the operator
 * just ran a sibling task moments earlier. When the flag is on, this
 * module persists each call's prior assistant response under a
 * `planningSessionId` cookie so the next endpoint can echo prior context
 * back into the prompt. Net effect: Claude doesn't re-explain the
 * rotation logic it already worked out.
 *
 * In-memory only; sessions expire after 30 minutes. Persistence across
 * deploys is intentionally out of scope.
 */

import { randomUUID } from 'node:crypto';

const SESSION_TTL_MS = 30 * 60 * 1000;
const MAX_TURNS_PER_SESSION = 8;

export interface PriorTurn {
  endpoint: 'suggest' | 'optimize' | 'allocate' | 'groups';
  /** The user prompt sent to Claude (for explainability — not echoed back). */
  userPrompt: string;
  /** Claude's response text. Echoed verbatim into the next call's
   *  message history when threading is enabled. */
  assistantResponse: string;
  /** Token usage for this turn (powers the telemetry summary). */
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  occurredAt: number;
}

interface SessionEntry {
  sessionId: string;
  turns: PriorTurn[];
  createdAt: number;
  lastUsedAt: number;
}

const sessions = new Map<string, SessionEntry>();

export function isThreadingEnabled(): boolean {
  return process.env.CROPCARD_AI_THREAD === '1' || process.env.CROPCARD_AI_THREAD === 'true';
}

export function createPlanningSession(): string {
  const id = randomUUID();
  sessions.set(id, {
    sessionId: id,
    turns: [],
    createdAt: Date.now(),
    lastUsedAt: Date.now()
  });
  evictExpired();
  return id;
}

export function appendTurn(sessionId: string, turn: PriorTurn): void {
  const s = sessions.get(sessionId);
  if (!s) return;
  s.turns.push(turn);
  if (s.turns.length > MAX_TURNS_PER_SESSION) {
    s.turns.splice(0, s.turns.length - MAX_TURNS_PER_SESSION);
  }
  s.lastUsedAt = Date.now();
}

export function getPriorTurns(sessionId: string | null | undefined): ReadonlyArray<PriorTurn> {
  if (!sessionId) return [];
  const s = sessions.get(sessionId);
  if (!s) return [];
  if (Date.now() - s.lastUsedAt > SESSION_TTL_MS) {
    sessions.delete(sessionId);
    return [];
  }
  return s.turns;
}

/**
 * Build the Anthropic-shaped messages array that includes prior turns
 * before the new user prompt. Compact format — prior assistant responses
 * are echoed verbatim, prior user prompts are summarized to avoid
 * doubling the input token count.
 *
 * Returns just `[{ role: 'user', content: newPrompt }]` when the flag is
 * off or the session has no turns.
 */
export function buildThreadedMessages(
  sessionId: string | null | undefined,
  newUserPrompt: string
): Array<{ role: 'user' | 'assistant'; content: string }> {
  if (!isThreadingEnabled() || !sessionId) {
    return [{ role: 'user', content: newUserPrompt }];
  }
  const turns = getPriorTurns(sessionId);
  if (turns.length === 0) {
    return [{ role: 'user', content: newUserPrompt }];
  }

  const messages: Array<{ role: 'user' | 'assistant'; content: string }> = [];
  for (const t of turns) {
    messages.push({
      role: 'user',
      content: `[Prior ${t.endpoint} request]\n${condense(t.userPrompt)}`
    });
    messages.push({ role: 'assistant', content: t.assistantResponse });
  }
  messages.push({ role: 'user', content: newUserPrompt });
  return messages;
}

export function clearPlanningSessions(): void {
  sessions.clear();
}

export function getPlanningSessionStats(): {
  sessions: number;
  totalTurns: number;
  oldestAgeMs: number | null;
} {
  let totalTurns = 0;
  let oldest: number | null = null;
  const now = Date.now();
  for (const s of sessions.values()) {
    totalTurns += s.turns.length;
    const age = now - s.createdAt;
    if (oldest === null || age > oldest) oldest = age;
  }
  return {
    sessions: sessions.size,
    totalTurns,
    oldestAgeMs: oldest
  };
}

function condense(prompt: string, maxLen = 400): string {
  if (prompt.length <= maxLen) return prompt;
  return `${prompt.slice(0, maxLen)}…[truncated ${prompt.length - maxLen} chars]`;
}

function evictExpired(): void {
  const now = Date.now();
  for (const [id, s] of sessions) {
    if (now - s.lastUsedAt > SESSION_TTL_MS) {
      sessions.delete(id);
    }
  }
}

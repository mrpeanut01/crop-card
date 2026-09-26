/**
 * Externally scheduled wakeup for the push alert tick.
 *
 * The app scales to zero, so an in-process timer never fires while it sleeps
 * and keeps a warm replica busy while it's up. Instead the `push-tick` Azure
 * Container Apps Job (infra/azure/main.bicep) POSTs /api/internal/push-tick
 * twice a day with a shared secret. The request is the only thing that wakes
 * the app for alerts; the job itself never touches the database.
 */

import { createHash, timingSafeEqual } from 'node:crypto';
import { runPushTick, type PushTickDeps, type PushTickSummary } from './scheduler';
import { emailAlertOrigin } from './emailAlerts';
import { readVapidConfig } from './webPush';

export const INTERNAL_TICK_PATH = '/api/internal/push-tick';
export const TICK_SECRET_HEADER = 'x-push-tick-secret';

/** Too short to be a generated secret; treat as unset rather than guessable. */
const MIN_SECRET_LENGTH = 32;

export function readTickSecret(env: Record<string, string | undefined>): string | null {
  const s = env.PUSH_TICK_SECRET?.trim();
  return s && s.length >= MIN_SECRET_LENGTH ? s : null;
}

/** Constant-time compare; hashing first makes unequal lengths safe too. */
export function tickSecretMatches(provided: string | null, expected: string): boolean {
  if (!provided) return false;
  const a = createHash('sha256').update(provided).digest();
  const b = createHash('sha256').update(expected).digest();
  return timingSafeEqual(a, b);
}

/**
 * hooks.server.ts skips session resolution, CSRF and the tenant wrapper for
 * this request only; the endpoint then requires the secret. Without the
 * header the request goes through the normal pipeline (401 anonymous, 404
 * from the endpoint for a signed-in user).
 */
export function isInternalTickRequest(pathname: string, headers: Headers): boolean {
  return pathname === INTERNAL_TICK_PATH && headers.has(TICK_SECRET_HEADER);
}

export type TickPushResult = PushTickSummary | { skipped: 'alerts-not-configured' };

export interface TickResult {
  startedAt: string;
  durationMs: number;
  push: TickPushResult;
  /** True when this call joined a tick that was already running. */
  joined: boolean;
}

export interface ScheduledTickDeps extends Omit<PushTickDeps, 'config'> {
  env?: Record<string, string | undefined>;
}

let inFlight: Promise<Omit<TickResult, 'joined'>> | null = null;

async function runOnce(deps: ScheduledTickDeps): Promise<Omit<TickResult, 'joined'>> {
  const now = deps.now ?? Date.now;
  const started = now();
  const env = deps.env ?? process.env;
  const config = readVapidConfig(env);
  const emailOrigin = deps.emailOrigin !== undefined ? deps.emailOrigin : emailAlertOrigin(env);
  const push: TickPushResult =
    config || emailOrigin
      ? await runPushTick({ ...deps, config, emailOrigin })
      : { skipped: 'alerts-not-configured' };
  return { startedAt: new Date(started).toISOString(), durationMs: now() - started, push };
}

/**
 * One tick for all Owners. Overlapping calls (a job retry landing while the
 * first request is still working) join the running tick instead of starting
 * a second one; the `push_deliveries` sent-log already makes a later tick
 * send nothing twice.
 */
export async function runScheduledTick(deps: ScheduledTickDeps = {}): Promise<TickResult> {
  if (inFlight) return { ...(await inFlight), joined: true };
  const run = runOnce(deps);
  inFlight = run;
  try {
    return { ...(await run), joined: false };
  } finally {
    inFlight = null;
  }
}

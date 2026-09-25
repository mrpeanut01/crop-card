/**
 * SMS transport, chosen at call time by `SMS_TRANSPORT` (mirrors email.ts):
 *   - unset / `stdout` (default) → logs to stdout so dev codes are visible.
 *   - `none`                     → no-op.
 *   - `pingram`                  → POST api.pingram.io/sms with $PINGRAM_API_KEY.
 *   - `memory`                   → in-process outbox for tests; refused unless
 *                                  NODE_ENV=test or E2E_OUTBOX=1.
 *
 * Direct REST, no SDK, same as the email adapters. The message body is
 * built by the caller; this module only delivers it.
 */

export interface OutboundSms {
  /** E.164. */
  to: string;
  body: string;
  /** Provider-side category, e.g. 'login-code'. */
  kind: string;
}

export interface SmsOutboxEntry extends OutboundSms {
  sentAt: number;
}

export const PINGRAM_SMS_TIMEOUT_MS = 10_000;
const OUTBOX_LIMIT = 200;
const memoryOutbox: SmsOutboxEntry[] = [];

export class SmsTransportError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly cause?: unknown
  ) {
    super(message);
    this.name = 'SmsTransportError';
  }
}

export function smsOutboxEnabled(): boolean {
  return (
    process.env.SMS_TRANSPORT === 'memory' &&
    (process.env.NODE_ENV === 'test' || process.env.E2E_OUTBOX === '1')
  );
}

export function readSmsOutbox(to?: string): SmsOutboxEntry[] {
  if (!smsOutboxEnabled()) return [];
  return memoryOutbox.filter((e) => !to || e.to === to);
}

export function clearSmsOutbox(): void {
  memoryOutbox.length = 0;
}

export async function dispatchSms(sms: OutboundSms): Promise<void> {
  const transport = process.env.SMS_TRANSPORT ?? 'stdout';
  if (transport === 'none') return;

  if (transport === 'pingram') {
    await dispatchPingramSms(sms);
    return;
  }

  if (transport === 'memory') {
    if (!smsOutboxEnabled()) {
      throw new SmsTransportError('SMS_TRANSPORT=memory requires NODE_ENV=test or E2E_OUTBOX=1');
    }
    memoryOutbox.push({ ...sms, sentAt: Date.now() });
    if (memoryOutbox.length > OUTBOX_LIMIT) memoryOutbox.shift();
    return;
  }

  // eslint-disable-next-line no-console
  console.log(`[sms] to=${sms.to}\n${sms.body}\n[/sms]`);
}

async function dispatchPingramSms(sms: OutboundSms): Promise<void> {
  const apiKey = process.env.PINGRAM_API_KEY;
  if (!apiKey) throw new SmsTransportError('PINGRAM_API_KEY not configured');
  let res: Response;
  try {
    res = await fetch('https://api.pingram.io/sms', {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify({ type: sms.kind, to: sms.to, message: sms.body }),
      signal: AbortSignal.timeout(PINGRAM_SMS_TIMEOUT_MS)
    });
  } catch (e) {
    throw new SmsTransportError(
      'Pingram SMS dispatch failed: request error or timeout',
      undefined,
      e
    );
  }
  const detail = await res.text().catch(() => '');
  if (!res.ok) {
    throw new SmsTransportError(
      `Pingram SMS dispatch failed: ${res.status} ${res.statusText} ${detail || '(no body)'}`,
      res.status
    );
  }
  let payload: { error?: { code?: string; message?: string } } = {};
  try {
    payload = detail ? JSON.parse(detail) : {};
  } catch {
    // A 2xx with a non-JSON body is treated as accepted.
  }
  if (payload.error) {
    throw new SmsTransportError(
      `Pingram SMS dispatch failed: ${payload.error.code ?? 'error'} ${payload.error.message ?? ''}`.trim(),
      res.status
    );
  }
}

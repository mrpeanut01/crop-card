// @vitest-environment node
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { db } from '$lib/db/client';
import { users } from '$lib/db/schema';
import {
  clearEmailUnsubscribe,
  isEmailSuppressed,
  listSuppressions
} from '$lib/db/contactSuppressions';
import { pingramTypeForCategory } from './emailPrefs';
import {
  applyPingramEvent,
  failureReason,
  signPingramPayload,
  verifyPingramSignature
} from './pingramWebhook';

const SECRET = 'whsec_test';

function signed(body: string, opts: { ts?: number; secret?: string; id?: string } = {}) {
  const id = opts.id ?? `evt_${randomUUID()}`;
  const timestamp = String(opts.ts ?? Date.now());
  return {
    id,
    timestamp,
    signature: signPingramPayload(id, timestamp, body, opts.secret ?? SECRET)
  };
}

describe('verifyPingramSignature', () => {
  it('accepts a correctly signed body', () => {
    const body = '{"eventType":"EMAIL_DELIVERED"}';
    expect(() => verifyPingramSignature({ body, ...signed(body), secret: SECRET })).not.toThrow();
  });

  it('rejects tampering, a wrong secret, stale timestamps and malformed headers', () => {
    const body = '{"eventType":"EMAIL_UNSUBSCRIBE","userId":"a@b.test"}';
    const h = signed(body);
    const bad = (over: Partial<typeof h> & { body?: string; nowMs?: number }) =>
      expect(() => verifyPingramSignature({ body, ...h, secret: SECRET, ...over })).toThrowError();
    bad({ body: body.replace('a@b', 'c@d') });
    bad({ signature: signed(body, { secret: 'other' }).signature });
    bad({ nowMs: Number(h.timestamp) + 301_000 });
    bad({ signature: h.signature.replace('v1,', 'v2,') });
    bad({ signature: 'v1,' });
    bad({ id: 'evt_other' });
    bad({ id: null as unknown as string });
    bad({ timestamp: 'yesterday' });
    expect(() =>
      verifyPingramSignature({ body, ...h, secret: SECRET, nowMs: Number(h.timestamp) + 299_000 })
    ).not.toThrow();
  });
});

describe('applyPingramEvent', () => {
  it('keeps a second typed unsubscribe for the same address (either order)', () => {
    for (const order of [
      ['weekly-digest', 'field-alerts'],
      ['field-alerts', 'weekly-digest']
    ]) {
      const addr = `pg-${randomUUID()}@example.test`;
      order.forEach((t, i) =>
        applyPingramEvent(
          { eventType: 'EMAIL_UNSUBSCRIBE', userId: addr, notificationId: t },
          `evt-${i}`
        )
      );
      expect(listSuppressions(addr, 'email')).toHaveLength(2);
      expect(isEmailSuppressed(addr, 'field-alerts')).toBe(true);
      expect(isEmailSuppressed(addr, 'weekly-digest')).toBe(true);
    }
  });

  it('a fresh opt-in lifts only the unsubscribe for that category', () => {
    const addr = `pg-${randomUUID()}@example.test`;
    applyPingramEvent(
      { eventType: 'EMAIL_UNSUBSCRIBE', userId: addr, notificationId: 'weekly-digest' },
      'e1'
    );
    applyPingramEvent(
      { eventType: 'EMAIL_UNSUBSCRIBE', userId: addr, notificationId: 'field-alerts' },
      'e2'
    );
    clearEmailUnsubscribe(addr, pingramTypeForCategory('frost-tonight'));
    expect(isEmailSuppressed(addr, 'field-alerts')).toBe(false);
    expect(isEmailSuppressed(addr, 'weekly-digest')).toBe(true);
    clearEmailUnsubscribe(addr, pingramTypeForCategory('weekly-digest'));
    expect(isEmailSuppressed(addr, 'weekly-digest')).toBe(false);
  });

  it('records an email unsubscribe by address, idempotently', () => {
    const addr = `pg-${randomUUID()}@Example.test`;
    const e = { eventType: 'EMAIL_UNSUBSCRIBE', userId: addr, notificationId: 'field-alerts' };
    expect(applyPingramEvent(e, 'evt1')).toMatchObject({
      action: 'recorded',
      reason: 'unsubscribe'
    });
    applyPingramEvent(e, 'evt2');
    expect(listSuppressions(addr, 'email')).toHaveLength(1);
    expect(isEmailSuppressed(addr.toLowerCase())).toBe(true);
  });

  it('resolves a CropCard user id to that user email', () => {
    const id = `pg-user-${randomUUID()}`;
    const email = `${id}@example.test`;
    db.insert(users).values({ id, email }).run();
    expect(applyPingramEvent({ eventType: 'EMAIL_UNSUBSCRIBE', userId: id }, 'e')).toMatchObject({
      action: 'recorded',
      address: email
    });
  });

  it('logs a plain failure without pausing email, but a bounce or complaint pauses it', () => {
    const a = `pg-${randomUUID()}@example.test`;
    applyPingramEvent({ eventType: 'EMAIL_FAILED', userId: a, failureCode: 'Timeout' }, 'e');
    expect(isEmailSuppressed(a)).toBe(false);
    applyPingramEvent(
      { eventType: 'EMAIL_FAILED', userId: a, failureCode: 'PermanentBounce' },
      'e'
    );
    expect(isEmailSuppressed(a)).toBe(true);
    expect(failureReason('Complaint')).toBe('complaint');
    expect(failureReason(undefined)).toBe('failed');
  });

  it('tracks SMS STOP and START by phone number', () => {
    const phone = `+1571${String(Date.now()).slice(-7)}`;
    applyPingramEvent({ eventType: 'SMS_UNSUBSCRIBE', userId: phone }, 'e');
    expect(listSuppressions(phone, 'sms')).toHaveLength(1);
    expect(applyPingramEvent({ eventType: 'SMS_SUBSCRIBE', userId: phone }, 'e').action).toBe(
      'cleared'
    );
    expect(listSuppressions(phone, 'sms')).toHaveLength(0);
  });

  it('ignores events it does not act on and unknown users', () => {
    expect(applyPingramEvent({ eventType: 'EMAIL_OPEN', userId: 'a@b.test' }, 'e').action).toBe(
      'ignored'
    );
    expect(
      applyPingramEvent({ eventType: 'EMAIL_UNSUBSCRIBE', userId: 'nobody' }, 'e').action
    ).toBe('ignored');
    expect(applyPingramEvent({ eventType: 'EMAIL_UNSUBSCRIBE' }, 'e').action).toBe('ignored');
  });
});

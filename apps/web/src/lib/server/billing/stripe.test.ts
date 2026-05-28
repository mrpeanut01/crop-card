import { describe, it, expect } from 'vitest';
import { createHmac } from 'node:crypto';
import { verifyWebhookSignature, StripeWebhookError } from './stripe';

const SECRET = 'whsec_test_secret';

function signStripeBody(body: string, secret: string, tsSeconds: number): string {
  const h = createHmac('sha256', secret).update(`${tsSeconds}.${body}`).digest('hex');
  return `t=${tsSeconds},v1=${h}`;
}

describe('stripe webhook signature verification', () => {
  it('accepts a correctly-signed body within the tolerance window', () => {
    const now = 1_700_000_000_000;
    const ts = Math.floor(now / 1000);
    const body = '{"id":"evt_test","type":"customer.subscription.created"}';
    const sig = signStripeBody(body, SECRET, ts);
    expect(() => verifyWebhookSignature(body, sig, SECRET, now)).not.toThrow();
  });

  it('rejects a forged body with a corrupted v1 signature', () => {
    const now = 1_700_000_000_000;
    const ts = Math.floor(now / 1000);
    const body = '{"id":"evt_test"}';
    const sig = signStripeBody(body, SECRET, ts).replace(/v1=./, 'v1=0');
    expect(() => verifyWebhookSignature(body, sig, SECRET, now)).toThrow(StripeWebhookError);
  });

  it('rejects an event whose body was tampered with after signing', () => {
    const now = 1_700_000_000_000;
    const ts = Math.floor(now / 1000);
    const sig = signStripeBody('{"id":"evt_orig"}', SECRET, ts);
    const tampered = '{"id":"evt_tampered"}';
    expect(() => verifyWebhookSignature(tampered, sig, SECRET, now)).toThrow(StripeWebhookError);
  });

  it('rejects a timestamp outside the 300s tolerance (replay protection)', () => {
    const now = 1_700_000_000_000;
    const oldTs = Math.floor(now / 1000) - 600; // 10 minutes old
    const body = '{"id":"evt_replay"}';
    const sig = signStripeBody(body, SECRET, oldTs);
    expect(() => verifyWebhookSignature(body, sig, SECRET, now)).toThrow(
      /timestamp skew 600s > 300s/
    );
  });

  it('rejects a missing or malformed signature header', () => {
    expect(() => verifyWebhookSignature('{}', null, SECRET)).toThrow(
      /missing Stripe-Signature/
    );
    expect(() => verifyWebhookSignature('{}', 'totally-bogus', SECRET)).toThrow(
      /malformed Stripe-Signature/
    );
  });

  it('rejects a non-numeric timestamp value', () => {
    const sig = 't=abc,v1=ff';
    expect(() => verifyWebhookSignature('{}', sig, SECRET)).toThrow(
      /non-numeric Stripe-Signature timestamp/
    );
  });
});

// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  signUnsubscribeToken,
  unsubscribeLinks,
  verifyUnsubscribeToken,
  type UnsubscribeScope
} from './emailUnsubscribe';
import { EMAIL_ALERT_CATEGORIES } from '$lib/email/alertCategories';

const scopes: UnsubscribeScope[] = [...EMAIL_ALERT_CATEGORIES, 'all'];
const idArb = fc.string({ minLength: 1, maxLength: 60 });
const claimsArb = fc.record({
  userId: idArb,
  ownerId: idArb,
  scope: fc.constantFrom(...scopes)
});

describe('unsubscribe tokens', () => {
  const saved = process.env.AUTH_SECRET;
  afterEach(() => {
    if (saved === undefined) delete process.env.AUTH_SECRET;
    else process.env.AUTH_SECRET = saved;
  });

  it('round-trips any user, owner and scope', () => {
    fc.assert(
      fc.property(claimsArb, (claims) => {
        expect(verifyUnsubscribeToken(signUnsubscribeToken(claims))).toEqual(claims);
      })
    );
  });

  it('rejects any single-character change to a token', () => {
    fc.assert(
      fc.property(
        claimsArb,
        fc.nat(),
        fc.constantFrom('A', 'b', '0', '_', '-', '.'),
        (c, i, ch) => {
          const token = signUnsubscribeToken(c);
          const at = i % token.length;
          if (token[at] === ch) return;
          const forged = token.slice(0, at) + ch + token.slice(at + 1);
          expect(verifyUnsubscribeToken(forged)).toBeNull();
        }
      )
    );
  });

  it('never lets one user unsubscribe someone else by editing the payload', () => {
    const token = signUnsubscribeToken({ userId: 'u-a', ownerId: 'o-1', scope: 'decon-due' });
    const [v, , sig] = token.split('.');
    const payload = Buffer.from(JSON.stringify({ u: 'u-b', o: 'o-1', c: 'decon-due' })).toString(
      'base64url'
    );
    expect(verifyUnsubscribeToken(`${v}.${payload}.${sig}`)).toBeNull();
  });

  it('rejects a token signed with another secret, garbage and unknown categories', () => {
    process.env.AUTH_SECRET = 'secret-one';
    const token = signUnsubscribeToken({ userId: 'u', ownerId: 'o', scope: 'all' });
    process.env.AUTH_SECRET = 'secret-two';
    expect(verifyUnsubscribeToken(token)).toBeNull();
    expect(verifyUnsubscribeToken('')).toBeNull();
    expect(verifyUnsubscribeToken(null)).toBeNull();
    expect(verifyUnsubscribeToken('u1.x.y')).toBeNull();
    expect(verifyUnsubscribeToken('x'.repeat(2000))).toBeNull();
    const bad = signUnsubscribeToken({
      userId: 'u',
      ownerId: 'o',
      scope: 'marketing' as unknown as UnsubscribeScope
    });
    expect(verifyUnsubscribeToken(bad)).toBeNull();
  });

  it('does not expire', () => {
    const token = signUnsubscribeToken({ userId: 'u', ownerId: 'o', scope: 'frost-tonight' });
    expect(verifyUnsubscribeToken(token)?.scope).toBe('frost-tonight');
  });

  it('builds a page link and an RFC 8058 one-click link on the given origin', () => {
    const links = unsubscribeLinks('https://app.cropcard.io/', {
      userId: 'u',
      ownerId: 'o',
      scope: 'decon-due'
    });
    expect(links.pageUrl).toMatch(/^https:\/\/app\.cropcard\.io\/unsubscribe\/u1\./);
    const one = new URL(links.oneClickUrl);
    expect(one.pathname).toBe('/api/email/unsubscribe');
    expect(verifyUnsubscribeToken(one.searchParams.get('t'))?.userId).toBe('u');
    expect(verifyUnsubscribeToken(links.pageUrl.split('/unsubscribe/')[1])?.ownerId).toBe('o');
  });
});

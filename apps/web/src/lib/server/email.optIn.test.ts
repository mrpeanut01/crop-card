// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fc from 'fast-check';
import {
  clearOutbox,
  dispatchEmail,
  EMAIL_KIND_CLASS,
  isOptInEmail,
  PINGRAM_TYPE,
  readOutbox,
  unsubscribeHeaders,
  type AlertEmail,
  type OutboundEmail
} from './email';
import { unsubscribeLinks, verifyUnsubscribeToken } from './emailUnsubscribe';
import { EMAIL_ALERT_CATEGORIES, type EmailAlertCategory } from '$lib/email/alertCategories';

const ORIGIN = 'https://app.cropcard.io';

function alert(category: EmailAlertCategory | null, to = 'grower@example.com'): AlertEmail {
  return {
    kind: 'field-alert',
    to,
    category,
    farmName: 'Safe Haven Farm',
    title: 'Decon due · Tank A',
    body: 'Tank A still carries insecticide-load.',
    actionUrl: `${ORIGIN}/spray/decon`,
    settingsUrl: `${ORIGIN}/settings/notifications`,
    unsubscribe: unsubscribeLinks(ORIGIN, {
      userId: 'user-1',
      ownerId: 'owner-1',
      scope: category ?? 'all'
    })
  };
}

const transactional: OutboundEmail[] = [
  {
    kind: 'magic-link',
    to: 'a@example.com',
    loginUrl: `${ORIGIN}/auth/verify?token=t`,
    code: '123456',
    expiresAt: Date.now() + 60_000
  },
  {
    kind: 'helper-invite',
    to: 'b@example.com',
    ownerName: 'Safe Haven Farm',
    acceptUrl: `${ORIGIN}/invite/x`,
    expiresAt: Date.now() + 86_400_000
  },
  {
    kind: 'contact-code',
    to: 'c@example.com',
    code: '654321',
    expiresAt: Date.now() + 60_000,
    origin: ORIGIN
  }
];

beforeEach(() => {
  vi.stubEnv('EMAIL_TRANSPORT', 'memory');
  clearOutbox();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('email classification', () => {
  it('classifies every kind, and only sign-in, invite and address codes skip consent', () => {
    expect(Object.keys(EMAIL_KIND_CLASS).sort()).toEqual(
      ['contact-code', 'field-alert', 'helper-invite', 'magic-link'].sort()
    );
    const transactionalKinds = Object.entries(EMAIL_KIND_CLASS)
      .filter(([, c]) => c === 'transactional')
      .map(([k]) => k)
      .sort();
    expect(transactionalKinds).toEqual(['contact-code', 'helper-invite', 'magic-link']);
  });

  it('never shares a Pingram type between transactional and opt-in mail', () => {
    const optInTypes = new Set(
      Object.entries(PINGRAM_TYPE)
        .filter(([k]) => EMAIL_KIND_CLASS[k as OutboundEmail['kind']] === 'opt-in')
        .map(([, t]) => t)
    );
    for (const [k, t] of Object.entries(PINGRAM_TYPE)) {
      if (EMAIL_KIND_CLASS[k as OutboundEmail['kind']] === 'transactional') {
        expect(optInTypes.has(t)).toBe(false);
      }
    }
  });
});

describe('opt-in mail carries unsubscribe', () => {
  it('every opt-in send has RFC 2369 + RFC 8058 headers and a visible link (any category)', async () => {
    await fc.assert(
      fc.asyncProperty(fc.constantFrom(...EMAIL_ALERT_CATEGORIES, null), async (category) => {
        clearOutbox();
        const email = alert(category);
        await dispatchEmail(email);
        const [sent] = readOutbox(email.to);
        expect(sent.headers['List-Unsubscribe']).toBe(`<${email.unsubscribe.oneClickUrl}>`);
        expect(sent.headers['List-Unsubscribe-Post']).toBe('List-Unsubscribe=One-Click');
        expect(sent.body).toContain(email.unsubscribe.pageUrl);
        expect(sent.body).toContain(email.settingsUrl);
        const token = new URL(email.unsubscribe.oneClickUrl).searchParams.get('t');
        expect(verifyUnsubscribeToken(token)?.scope).toBe(category ?? 'all');
      })
    );
  });

  it('transactional mail carries no List-Unsubscribe header', async () => {
    for (const email of transactional) {
      expect(isOptInEmail(email)).toBe(false);
      expect(unsubscribeHeaders(email)).toBeNull();
      await dispatchEmail(email);
      expect(readOutbox(email.to).at(-1)?.headers).toEqual({});
    }
  });

  it('refuses to send opt-in mail without absolute https unsubscribe links', async () => {
    const bad = alert('decon-due');
    await expect(
      dispatchEmail({ ...bad, unsubscribe: { pageUrl: '/unsubscribe/x', oneClickUrl: 'x' } })
    ).rejects.toMatchObject({ name: 'EmailTransportError' });
    await expect(
      dispatchEmail({
        ...bad,
        unsubscribe: {
          pageUrl: 'http://evil.example/unsubscribe/x',
          oneClickUrl: 'http://evil.example/api/email/unsubscribe?t=x'
        }
      })
    ).rejects.toMatchObject({ name: 'EmailTransportError' });
    expect(readOutbox()).toHaveLength(0);
  });

  it('names the category and the farm in the body', async () => {
    await dispatchEmail(alert('frost-tonight'));
    const [sent] = readOutbox();
    expect(sent.subject).toBe('Decon due · Tank A · Safe Haven Farm');
    expect(sent.body).toContain('"Frost tonight" emails for Safe Haven Farm');
    expect(sent.body).not.toContain('—');
  });

  it('Postmark gets the unsubscribe headers in its Headers array', async () => {
    vi.stubEnv('EMAIL_TRANSPORT', 'postmark');
    vi.stubEnv('POSTMARK_TOKEN', 't');
    const fetchMock = vi.fn(async (_u: string, _i?: RequestInit) => new Response('{}'));
    vi.stubGlobal('fetch', fetchMock);
    const email = alert('decon-due');
    await dispatchEmail(email);
    const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    expect(body.Headers).toEqual([
      { Name: 'List-Unsubscribe', Value: `<${email.unsubscribe.oneClickUrl}>` },
      { Name: 'List-Unsubscribe-Post', Value: 'List-Unsubscribe=One-Click' }
    ]);
    await dispatchEmail(transactional[0]);
    expect(JSON.parse(String(fetchMock.mock.calls[1][1]?.body)).Headers).toBeUndefined();
  });

  it('Pingram sends alert mail under its own type with the unsubscribe link in the HTML', async () => {
    vi.stubEnv('EMAIL_TRANSPORT', 'pingram');
    vi.stubEnv('PINGRAM_API_KEY', 'k');
    const fetchMock = vi.fn(async (_u: string, _i?: RequestInit) => new Response('{}'));
    vi.stubGlobal('fetch', fetchMock);
    const email = alert('decon-due');
    await dispatchEmail(email);
    const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    expect(body.type).toBe('field-alerts');
    expect(body.html).toContain(`href="${email.unsubscribe.pageUrl}"`);
  });
});

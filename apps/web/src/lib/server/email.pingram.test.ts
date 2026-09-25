import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { dispatchEmail, EmailTransportError, textToHtml } from './email';

const MAGIC = {
  kind: 'magic-link' as const,
  to: 'owner@example.com',
  loginUrl: 'https://app.example/login/abc?x=1&y=2',
  code: '042917',
  expiresAt: Date.now() + 15 * 60_000
};

beforeEach(() => {
  vi.stubEnv('EMAIL_TRANSPORT', 'pingram');
  vi.stubEnv('PINGRAM_API_KEY', 'pingram_sk_test');
  vi.stubEnv('EMAIL_FROM', '');
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('Pingram transport', () => {
  it('posts a bearer-authenticated HTML email with an abort-timeout signal', async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => {
      return new Response('{"trackingId":"t1","messages":[]}', { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);
    await dispatchEmail(MAGIC);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.pingram.io/email');
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    expect((init?.headers as Record<string, string>).Authorization).toBe('Bearer pingram_sk_test');
    const body = JSON.parse(String(init?.body));
    expect(body).toMatchObject({
      type: 'magic-link',
      to: 'owner@example.com',
      subject: 'Your CropCard sign-in link (code 042917)',
      fromName: 'CropCard'
    });
    expect(body.fromAddress).toBeUndefined();
    expect(body.html).toContain('href="https://app.example/login/abc?x=1&amp;y=2"');
    expect(body.html).toContain('042917');
  });

  it('sends EMAIL_FROM as the from-address when set', async () => {
    vi.stubEnv('EMAIL_FROM', 'noreply@cropcard.farm');
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => new Response('{}'));
    vi.stubGlobal('fetch', fetchMock);
    await dispatchEmail(MAGIC);
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body)).fromAddress).toBe(
      'noreply@cropcard.farm'
    );
  });

  it('refuses to send without an API key', async () => {
    vi.stubEnv('PINGRAM_API_KEY', '');
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await expect(dispatchEmail(MAGIC)).rejects.toBeInstanceOf(EmailTransportError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('surfaces a timed-out request as EmailTransportError', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new DOMException('The operation was aborted due to timeout', 'TimeoutError');
      })
    );
    await expect(dispatchEmail(MAGIC)).rejects.toBeInstanceOf(EmailTransportError);
  });

  it('surfaces a non-2xx response as EmailTransportError with the status', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('bad', { status: 401, statusText: 'Unauthorized' }))
    );
    await expect(dispatchEmail(MAGIC)).rejects.toMatchObject({
      name: 'EmailTransportError',
      status: 401
    });
  });

  it('treats a 200 carrying an error payload as a failure', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response('{"trackingId":"t1","error":{"code":"SUPPRESSED","message":"bounced"}}', {
            status: 200
          })
      )
    );
    await expect(dispatchEmail(MAGIC)).rejects.toThrow(/SUPPRESSED bounced/);
  });
});

describe('textToHtml', () => {
  it('escapes markup so user-supplied invite messages cannot inject HTML', () => {
    const html = textToHtml('Message: <script>alert(1)</script>');
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });
});

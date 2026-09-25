import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { dispatchEmail, EmailTransportError } from './email';

const INVITE = {
  kind: 'helper-invite' as const,
  to: 'helper@example.com',
  ownerName: 'Test Farm',
  acceptUrl: 'https://app.example/invite/abc',
  expiresAt: Date.UTC(2026, 9, 1)
};

beforeEach(() => {
  vi.stubEnv('EMAIL_TRANSPORT', 'postmark');
  vi.stubEnv('POSTMARK_TOKEN', 'test-token');
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('Postmark transport', () => {
  it('sends with an abort-timeout signal', async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => {
      return new Response('{}', { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);
    await dispatchEmail(INVITE);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe('https://api.postmarkapp.com/email');
    expect(fetchMock.mock.calls[0][1]?.signal).toBeInstanceOf(AbortSignal);
  });

  it('surfaces a timed-out request as EmailTransportError', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new DOMException('The operation was aborted due to timeout', 'TimeoutError');
      })
    );
    await expect(dispatchEmail(INVITE)).rejects.toBeInstanceOf(EmailTransportError);
  });

  it('surfaces a non-2xx response as EmailTransportError with the status', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('bad', { status: 422, statusText: 'Unprocessable' }))
    );
    await expect(dispatchEmail(INVITE)).rejects.toMatchObject({
      name: 'EmailTransportError',
      status: 422
    });
  });
});

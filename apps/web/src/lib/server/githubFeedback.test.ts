// @vitest-environment node
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { createGithubIssue, githubFeedbackConfig } from './githubFeedback';

describe('githubFeedbackConfig', () => {
  it('needs both a token and an owner/repo', () => {
    expect(githubFeedbackConfig({})).toBeNull();
    expect(githubFeedbackConfig({ GITHUB_FEEDBACK_TOKEN: 't' })).toBeNull();
    expect(githubFeedbackConfig({ GITHUB_FEEDBACK_REPO: 'a/b' })).toBeNull();
    expect(
      githubFeedbackConfig({ GITHUB_FEEDBACK_TOKEN: 't', GITHUB_FEEDBACK_REPO: 'not a repo' })
    ).toBeNull();
    expect(
      githubFeedbackConfig({ GITHUB_FEEDBACK_TOKEN: ' t ', GITHUB_FEEDBACK_REPO: 'me/crop-card' })
    ).toEqual({ token: 't', repo: 'me/crop-card' });
  });
});

describe('createGithubIssue', () => {
  const config = { token: 'tok', repo: 'me/crop-card' };

  it('does nothing without configuration', async () => {
    const fetcher = vi.fn();
    const r = await createGithubIssue(
      { title: 't', body: 'b' },
      { config: null, fetcher: fetcher as never }
    );
    expect(r).toEqual({ ok: false, reason: 'not-configured' });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('posts to the repo issues API and returns the issue URL', async () => {
    const fetcher = vi.fn(
      async () =>
        new Response(
          JSON.stringify({ html_url: 'https://github.com/me/crop-card/issues/7', number: 7 }),
          {
            status: 201
          }
        )
    );
    const r = await createGithubIssue(
      { title: 'Bug: x', body: 'body' },
      { config, fetcher: fetcher as never, labels: ['feedback'] }
    );
    expect(r).toEqual({ ok: true, url: 'https://github.com/me/crop-card/issues/7', number: 7 });
    const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.github.com/repos/me/crop-card/issues');
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer tok');
    expect(JSON.parse(String(init.body))).toEqual({
      title: 'Bug: x',
      body: 'body',
      labels: ['feedback']
    });
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it('reports a refused request', async () => {
    const fetcher = vi.fn(async () => new Response('{}', { status: 401 }));
    const r = await createGithubIssue(
      { title: 't', body: 'b' },
      { config, fetcher: fetcher as never }
    );
    expect(r).toEqual({ ok: false, reason: 'rejected', status: 401 });
  });

  it('reports a network failure or timeout without throwing', async () => {
    const fetcher = vi.fn(async () => {
      throw new DOMException('timed out', 'TimeoutError');
    });
    const r = await createGithubIssue(
      { title: 't', body: 'b' },
      { config, fetcher: fetcher as never }
    );
    expect(r).toEqual({ ok: false, reason: 'request-failed' });
  });

  it('refuses a response URL outside github.com', async () => {
    const fetcher = vi.fn(
      async () =>
        new Response(JSON.stringify({ html_url: 'https://evil.example/x' }), { status: 201 })
    );
    const r = await createGithubIssue(
      { title: 't', body: 'b' },
      { config, fetcher: fetcher as never }
    );
    expect(r.ok).toBe(false);
  });
});

describe('ops documentation (r6)', () => {
  it('says notes are only sent by a superadmin, never posted on arrival', () => {
    const env = readFileSync(
      fileURLToPath(new URL('../../../../../infra/.env.dev.example', import.meta.url)),
      'utf8'
    );
    const block = env.slice(
      env.indexOf('# In-app feedback (#466)'),
      env.indexOf('GITHUB_FEEDBACK_REPO=')
    );
    expect(block).not.toMatch(/as it arrives/);
    expect(block).toMatch(/Nothing is ever posted to GitHub on\s+# arrival/);
  });
});

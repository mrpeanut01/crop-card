import { describe, expect, it, vi } from 'vitest';

const user = { id: 'wizard-helper', email: 'h@test', role: 'helper' as 'helper' | 'owner' };
vi.mock('$lib/server/auth', () => ({
  currentUser: () => user,
  requireUser: () => user,
  requireOwner: () => user
}));

import { POST as inputsCommitPost } from './inputs/commit/+server';
import { POST as draftPost, DELETE as draftDelete } from './wizard/draft/+server';

type Handler = (event: never) => Promise<Response> | Response;

function call(handler: Handler, method: string, body?: unknown, locale?: string) {
  const url = new URL('http://localhost/api/plan/test');
  const event = {
    request: new Request(url, {
      method,
      headers: { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body)
    }),
    params: {},
    url,
    locals: { locale },
    cookies: { get: () => undefined }
  };
  return handler(event as never);
}

describe('planning wizard writes are owner-only', () => {
  it('refuses a helper committing the inputs plan', async () => {
    const res = await call(inputsCommitPost as Handler, 'POST', { applications: [] });
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe('Only the owner can do that.');
  });

  it('refuses a helper saving or clearing the wizard draft, in their language', async () => {
    const save = await call(draftPost as Handler, 'POST', { step: 'blocks', payload: {} }, 'es');
    expect(save.status).toBe(403);
    expect((await save.json()).error).not.toBe('Only the owner can do that.');
    const del = await call(draftDelete as Handler, 'DELETE');
    expect(del.status).toBe(403);
  });
});

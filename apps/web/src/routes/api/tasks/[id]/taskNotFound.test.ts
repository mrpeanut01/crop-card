/**
 * PATCH to a nonexistent (or out-of-tenant) task id → clean 404 (#337).
 *
 * The repo throws `unknown task id: …` when the update touches no row. The
 * handler previously let that bubble to a raw 500 with an internal message;
 * it now maps that specific error to a 404. Well-formed requests that DO hit
 * a row are unaffected.
 *
 * `currentUser` + the task repo functions are mocked so the test targets the
 * handler's error mapping in isolation, with no DB dependency.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';

const { currentUser, abortTask, completeTask, updateTask } = vi.hoisted(() => ({
  currentUser: vi.fn(),
  abortTask: vi.fn(),
  completeTask: vi.fn(),
  updateTask: vi.fn()
}));

vi.mock('$lib/server/auth', () => ({ currentUser }));
vi.mock('$lib/db/tasks', () => ({
  abortTask,
  completeTask,
  updateTask,
  getTaskWithLinked: vi.fn()
}));

import { PATCH } from './+server';

function makeEvent(id: string, body: unknown) {
  return {
    params: { id },
    request: new Request('http://localhost/api/tasks/x', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body)
    })
  } as never;
}

beforeEach(() => {
  currentUser.mockReset();
  abortTask.mockReset();
  completeTask.mockReset();
  updateTask.mockReset();
  currentUser.mockReturnValue({ id: 'u1', role: 'owner' });
});

describe('task PATCH not-found mapping (#337)', () => {
  it('abort on a missing task → 404, not 500', async () => {
    abortTask.mockImplementation(() => {
      throw new Error('unknown task id: nope');
    });
    const res = await PATCH(makeEvent('nope', { action: 'abort' }));
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe('task not found');
  });

  it('complete on a missing task → 404', async () => {
    completeTask.mockImplementation(() => {
      throw new Error('unknown task id: nope');
    });
    const res = await PATCH(makeEvent('nope', { action: 'complete' }));
    expect(res.status).toBe(404);
  });

  it('reschedule on a missing task → 404', async () => {
    updateTask.mockImplementation(() => {
      throw new Error('unknown task id: nope');
    });
    const res = await PATCH(makeEvent('nope', { action: 'reschedule', scheduledFor: 123 }));
    expect(res.status).toBe(404);
  });

  it('a successful abort still returns the task (200)', async () => {
    abortTask.mockReturnValue({ id: 't1', title: 'Spray' });
    const res = await PATCH(makeEvent('t1', { action: 'abort' }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.task.id).toBe('t1');
  });

  it('a non-not-found error still propagates (not swallowed as 404)', async () => {
    abortTask.mockImplementation(() => {
      throw new Error('database is locked');
    });
    await expect(PATCH(makeEvent('t1', { action: 'abort' }))).rejects.toThrow('database is locked');
  });
});

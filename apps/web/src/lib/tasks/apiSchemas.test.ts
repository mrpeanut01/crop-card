import { describe, expect, it } from 'vitest';
import { taskCloseSchema, taskCreateSchema, taskPatchSchema } from './apiSchemas';

describe('task schemas (F1-13)', () => {
  it('Done takes whole minutes from 1 to 720 and Skip takes none', () => {
    expect(
      taskCloseSchema.safeParse({ taskId: 't', action: 'complete', minutes: 30 }).success
    ).toBe(true);
    for (const minutes of [0, 721, 2.5])
      expect(taskCloseSchema.safeParse({ taskId: 't', action: 'complete', minutes }).success).toBe(
        false
      );
    expect(taskCloseSchema.safeParse({ taskId: 't', action: 'abort', minutes: 30 }).success).toBe(
      false
    );
    expect(taskPatchSchema.safeParse({ action: 'complete', minutes: 120 }).success).toBe(true);
    expect(taskPatchSchema.safeParse({ action: 'abort', minutes: 5 }).success).toBe(false);
    expect(taskPatchSchema.safeParse({ action: 'abort', reason: 'rain' }).success).toBe(true);
  });

  it('assign takes a person or null', () => {
    expect(taskPatchSchema.safeParse({ action: 'assign', assigneeUserId: 'u1' }).success).toBe(
      true
    );
    expect(taskPatchSchema.safeParse({ action: 'assign', assigneeUserId: null }).success).toBe(
      true
    );
    expect(taskPatchSchema.safeParse({ action: 'assign' }).success).toBe(false);
    expect(
      taskCreateSchema.safeParse({
        title: 'Weed',
        kind: 'primary',
        scheduledFor: 1,
        assigneeUserId: 'u1'
      }).success
    ).toBe(true);
  });
});

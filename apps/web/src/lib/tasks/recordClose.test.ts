import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { recordCloseMessageKey, recordMatchesTask, taskClosedBy } from './recordClose';

describe('recordMatchesTask', () => {
  it('a task with no block and no crop matches any record', () => {
    expect(recordMatchesTask({}, { blockId: 'b1', cropId: 'c1', cropPluginId: 'tomato' })).toBe(
      true
    );
  });

  it('a different block is a mismatch', () => {
    expect(recordMatchesTask({ blockId: 'b1' }, { blockId: 'b2' })).toBe(false);
    expect(recordMatchesTask({ blockId: 'b1' }, { blockId: 'b1' })).toBe(true);
  });

  it('a different planting is a mismatch even on the same block', () => {
    expect(
      recordMatchesTask({ blockId: 'b1', cropId: 'c1' }, { blockId: 'b1', cropId: 'c2' })
    ).toBe(false);
  });

  it('with no planting on the record, the crop plugin decides', () => {
    const task = { blockId: 'b1', cropId: 'c1', cropPluginId: 'tomato' };
    expect(recordMatchesTask(task, { blockId: 'b1', cropPluginId: 'pepper' })).toBe(false);
    expect(recordMatchesTask(task, { blockId: 'b1', cropPluginId: 'tomato' })).toBe(true);
    expect(recordMatchesTask(task, { blockId: 'b1' })).toBe(true);
  });

  it('a record that has not picked a block yet does not mismatch', () => {
    expect(recordMatchesTask({ blockId: 'b1' }, {})).toBe(true);
  });

  it('a record always matches the task it was built from', () => {
    const id = fc.option(fc.constantFrom('a', 'b', 'c'), { nil: null });
    fc.assert(
      fc.property(id, id, id, (blockId, cropId, cropPluginId) => {
        const t = { blockId, cropId, cropPluginId };
        return recordMatchesTask(t, t);
      })
    );
  });
});

describe('recordCloseMessageKey', () => {
  it('only closed and mismatch say anything', () => {
    expect(recordCloseMessageKey({ taskId: 't', status: 'closed' })).toBe(
      'tasks.recordClose.closed'
    );
    expect(recordCloseMessageKey({ taskId: 't', status: 'mismatch' })).toBe(
      'tasks.recordClose.mismatch'
    );
    for (const status of ['already-closed', 'not-found', 'not-closable', 'failed'] as const) {
      expect(recordCloseMessageKey({ taskId: 't', status })).toBeNull();
    }
    expect(recordCloseMessageKey(null)).toBeNull();
  });
});

describe('taskClosedBy', () => {
  it('closed and already-closed end the task for the page', () => {
    expect(taskClosedBy({ taskId: 't', status: 'closed' })).toBe(true);
    expect(taskClosedBy({ taskId: 't', status: 'already-closed' })).toBe(true);
    for (const status of ['mismatch', 'not-found', 'not-closable', 'failed'] as const) {
      expect(taskClosedBy({ taskId: 't', status })).toBe(false);
    }
    expect(taskClosedBy(null)).toBe(false);
    expect(taskClosedBy(undefined)).toBe(false);
  });
});

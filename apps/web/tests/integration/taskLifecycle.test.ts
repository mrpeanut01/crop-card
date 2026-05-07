/**
 * Phase 12 — task lifecycle integration tests.
 *
 * Exercises the full create → materialize → complete / abort cascade flow
 * against the workspace-local SQLite. These are integration-flavored
 * (real DB), but isolated by using fresh randomUUIDs so they don't
 * collide with the user's data.
 */

import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  abortTask,
  completeTask,
  createTask,
  getTask,
  getTaskWithLinked,
  materializePluginPrePost
} from '$lib/db/tasks';
import type { CropPlugin } from '$lib/plugins/schemas';
import type { EquipmentTemplate } from '$lib/server/equipmentTemplates';

describe('task lifecycle', () => {
  it('creates a primary task and reads it back with empty linked list', () => {
    const t = createTask({
      title: `test-primary-${randomUUID().slice(0, 8)}`,
      kind: 'primary',
      scheduledFor: Date.now() + 86_400_000
    });
    const got = getTaskWithLinked(t.id);
    expect(got).toBeDefined();
    expect(got!.primary.id).toBe(t.id);
    expect(got!.linked).toEqual([]);
  });

  it('completeTask stamps completedAt + relatedEventTable + relatedEventId', () => {
    const primary = createTask({
      title: `test-complete-${randomUUID().slice(0, 8)}`,
      kind: 'primary',
      scheduledFor: Date.now()
    });
    completeTask(primary.id, {
      eventTable: 'spray_event',
      eventId: 'fake-event-id-123',
      occurredAt: 1_700_000_000_000
    });
    const refetched = getTask(primary.id);
    expect(refetched?.completedAt).toBe(1_700_000_000_000);
    expect(refetched?.relatedEventTable).toBe('spray_event');
    expect(refetched?.relatedEventId).toBe('fake-event-id-123');
  });

  it('abortTask cascades to open pre/post-tasks but skips already-completed', () => {
    const primary = createTask({
      title: `test-abort-${randomUUID().slice(0, 8)}`,
      kind: 'primary',
      scheduledFor: Date.now()
    });
    const pre = createTask({
      title: 'pre-1',
      kind: 'pre-task',
      linkedToTaskId: primary.id,
      scheduledFor: Date.now() - 86_400_000
    });
    const post = createTask({
      title: 'post-1',
      kind: 'post-task',
      linkedToTaskId: primary.id,
      scheduledFor: Date.now() + 86_400_000
    });
    // Mark the post-task complete BEFORE aborting the primary.
    completeTask(post.id);
    abortTask(primary.id, 'rain — bagged');

    expect(getTask(primary.id)?.abortedAt).toBeDefined();
    expect(getTask(pre.id)?.abortedAt).toBeDefined();
    expect(getTask(pre.id)?.abortReason).toBe('rain — bagged');
    // Already-completed post-task is untouched by the cascade.
    expect(getTask(post.id)?.abortedAt).toBeUndefined();
    expect(getTask(post.id)?.completedAt).toBeDefined();
  });
});

describe('materializePluginPrePost', () => {
  function fakeCropPlugin(id: string): CropPlugin {
    return {
      pluginId: id,
      type: 'crop',
      displayName: 'Test crop',
      version: '1.0.0',
      cropFamily: 'forage',
      preTasks: [
        {
          key: 'germ-test',
          title: 'Test germination 14 d before plant',
          daysBeforePlant: 14
        }
      ],
      postTasks: [
        {
          key: 'storage-temp',
          title: 'Check storage temperature 7d after harvest',
          daysAfterHarvest: 7
        }
      ]
    } as CropPlugin;
  }

  function fakeBalerTemplate(): EquipmentTemplate {
    return {
      templateId: `baler-${randomUUID().slice(0, 8)}`,
      type: 'baler',
      category: 'Test baler',
      label: 'Test baler',
      description: 'fixture',
      preTasks: [
        {
          key: 'bearings-after-storage',
          title: 'Check bearings — long sit',
          condition: 'last-used-gt-days',
          conditionDays: 90
        },
        {
          key: 'always-test-run',
          title: 'Test-bale 2 windrows',
          condition: 'always-before-use'
        }
      ]
    };
  }

  it('attaches plugin pre-tasks with the right scheduled_for offset', () => {
    const primary = createTask({
      title: `mat-test-${randomUUID().slice(0, 8)}`,
      kind: 'primary',
      scheduledFor: 2_000_000_000_000
    });
    const result = materializePluginPrePost({
      primaryTaskId: primary.id,
      scheduledFor: primary.scheduledFor,
      cropPlugin: fakeCropPlugin('matcrop')
    });
    expect(result.preTaskIds.length).toBe(1);
    expect(result.postTaskIds.length).toBe(1);
    const linked = getTaskWithLinked(primary.id)!.linked;
    const pre = linked.find((t) => t.kind === 'pre-task')!;
    const post = linked.find((t) => t.kind === 'post-task')!;
    // 14 days before the primary
    expect(primary.scheduledFor - pre.scheduledFor).toBe(14 * 86_400_000);
    // 7 days after
    expect(post.scheduledFor - primary.scheduledFor).toBe(7 * 86_400_000);
  });

  it('honors equipment last-used-gt-days condition', () => {
    const primary = createTask({
      title: `equip-test-${randomUUID().slice(0, 8)}`,
      kind: 'primary',
      scheduledFor: 2_000_000_000_000
    });
    const baler = fakeBalerTemplate();
    // Last used 200 days ago — > 90d threshold → fires.
    const oldUse = primary.scheduledFor - 200 * 86_400_000;
    const result = materializePluginPrePost({
      primaryTaskId: primary.id,
      scheduledFor: primary.scheduledFor,
      equipmentTemplate: baler,
      equipmentLastUsedAt: oldUse
    });
    expect(result.preTaskIds.length).toBe(2); // bearings + always-before
  });

  it('skips equipment last-used-gt-days when within threshold', () => {
    const primary = createTask({
      title: `equip-skip-${randomUUID().slice(0, 8)}`,
      kind: 'primary',
      scheduledFor: 2_000_000_000_000
    });
    const baler = fakeBalerTemplate();
    const recentUse = primary.scheduledFor - 30 * 86_400_000; // 30d < 90d
    const result = materializePluginPrePost({
      primaryTaskId: primary.id,
      scheduledFor: primary.scheduledFor,
      equipmentTemplate: baler,
      equipmentLastUsedAt: recentUse
    });
    // Only 'always-before-use' fires; the 90d gate doesn't.
    expect(result.preTaskIds.length).toBe(1);
  });

  it('is idempotent on pluginTemplateKey — re-running adds no duplicates', () => {
    const primary = createTask({
      title: `idem-test-${randomUUID().slice(0, 8)}`,
      kind: 'primary',
      scheduledFor: 2_000_000_000_000
    });
    materializePluginPrePost({
      primaryTaskId: primary.id,
      scheduledFor: primary.scheduledFor,
      cropPlugin: fakeCropPlugin('idemcrop')
    });
    const second = materializePluginPrePost({
      primaryTaskId: primary.id,
      scheduledFor: primary.scheduledFor,
      cropPlugin: fakeCropPlugin('idemcrop')
    });
    expect(second.preTaskIds).toEqual([]);
    expect(second.postTaskIds).toEqual([]);
  });
});

import { z } from 'zod';
import { EDIT_CONFLICT_API_NOTE as EDIT_CONFLICT_NOTE } from '$lib/edits/conflict';
import { healthRecordSchema } from '$lib/animals/recordApiSchemas';
import { SNOOZE_DAYS, isYmd } from '$lib/animals/carePlans';
import { MAX_TASK_MINUTES, MIN_TASK_MINUTES } from '$lib/labour/hours';

/** Whole minutes of work logged on Done (F1-13): 1 to 720. */
export const taskMinutesSchema = z.number().int().min(MIN_TASK_MINUTES).max(MAX_TASK_MINUTES);

/** Body of `POST /api/tasks/close`, the offline replay of a Done or Skip.
 *  An animal-care task (32D) may carry the treatment it records
 *  (`healthEvent`, the same body as `POST /api/animals/health/record`), the
 *  owner's next due day, and on Skip whether to skip this one or be
 *  reminded again in a few days. */
export const taskCloseSchema = z
  .object({
    taskId: z.string().min(1).max(200),
    action: z.enum(['complete', 'abort']),
    reason: z.string().max(500).optional(),
    occurredAt: z.number().int().positive().optional(),
    minutes: taskMinutesSchema.optional(),
    healthEvent: healthRecordSchema.optional(),
    nextDueOn: z.string().refine(isYmd, 'use YYYY-MM-DD').optional(),
    careSkip: z.enum(['skip-this', 'snooze']).optional(),
    snoozeDays: z
      .number()
      .int()
      .refine((n) => (SNOOZE_DAYS as readonly number[]).includes(n), 'snooze 1, 3 or 7 days')
      .optional()
  })
  .refine((v) => v.careSkip !== 'snooze' || v.snoozeDays !== undefined, {
    message: 'say how many days to wait',
    path: ['snoozeDays']
  })
  .refine((v) => v.action === 'complete' || v.minutes === undefined, {
    message: 'time is logged only on Done',
    path: ['minutes']
  });
export type TaskCloseInput = z.infer<typeof taskCloseSchema>;

/** Body of `POST /api/tasks`. `assigneeUserId` is for owners only (F1-2). */
export const taskCreateSchema = z
  .object({
    title: z.string().min(1).max(120),
    body: z.string().max(500).optional(),
    kind: z.enum(['primary', 'pre-task', 'post-task']),
    linkedToTaskId: z.string().optional(),
    cropId: z.string().optional(),
    blockId: z.string().optional(),
    equipmentId: z.string().optional(),
    scheduledFor: z.number().int(),
    pluginTemplateKey: z.string().optional(),
    assigneeUserId: z.string().min(1).max(200).nullable().optional()
  })
  .refine((v) => v.kind === 'primary' || !!v.linkedToTaskId, {
    message: 'pre-task / post-task requires linkedToTaskId'
  });
export type TaskCreateInput = z.infer<typeof taskCreateSchema>;

/** The values the device last saw, per edit action (Phase 36, E-03). */
export const taskEditBaseSchema = z
  .object({
    title: z.string().max(120).nullable().optional(),
    body: z.string().max(500).nullable().optional()
  })
  .strict();
export const taskRescheduleBaseSchema = z
  .object({ scheduledFor: z.number().int().nullable().optional() })
  .strict();
export const taskAssignBaseSchema = z
  .object({ assigneeUserId: z.string().max(200).nullable().optional() })
  .strict();

/** Body of `PATCH /api/tasks/:id`. */
export const taskPatchSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('complete'),
    occurredAt: z.number().int().optional(),
    minutes: taskMinutesSchema.optional()
  }),
  z.object({
    action: z.literal('abort'),
    reason: z.string().max(500).optional(),
    minutes: z.never({ message: 'time is logged only on Done' }).optional()
  }),
  z
    .object({
      action: z.literal('reschedule'),
      scheduledFor: z.number().int(),
      base: taskRescheduleBaseSchema.optional()
    })
    .describe('Move the task to another day.' + EDIT_CONFLICT_NOTE),
  z
    .object({
      action: z.literal('edit'),
      title: z.string().min(1).max(120).optional(),
      body: z.string().max(500).optional(),
      base: taskEditBaseSchema.optional()
    })
    .describe('Change the title or notes.' + EDIT_CONFLICT_NOTE),
  z
    .object({
      action: z.literal('assign'),
      assigneeUserId: z.string().min(1).max(200).nullable(),
      base: taskAssignBaseSchema.optional()
    })
    .describe('Owners only. Assign the task, or pass null for nobody.' + EDIT_CONFLICT_NOTE)
]);
export type TaskPatchInput = z.infer<typeof taskPatchSchema>;

/** Body of `POST /api/tasks/:id/time` (D-25): time from the task timer.
 *  `userId` names someone else's time, which only an owner may log. */
export const taskTimeEntrySchema = z.object({
  startedAt: z.number().int().positive(),
  minutes: taskMinutesSchema,
  note: z.string().max(500).optional(),
  userId: z.string().min(1).max(200).optional()
});
export type TaskTimeEntryInput = z.infer<typeof taskTimeEntrySchema>;

/** What the offline queue keeps for a `time-entry` row (D-29). The task id
 *  goes in the path on replay and is stripped from the body. */
export type TaskTimeEntryQueuePayload = TaskTimeEntryInput & { taskId: string };

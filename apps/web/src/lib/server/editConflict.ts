import { json } from '@sveltejs/kit';
import type { Crop } from '$lib/db/crops';
import type { Task } from '$lib/db/tasks';
import {
  EDIT_CONFLICT_CODE,
  editConflicts,
  type EditConflictBody,
  type EditTarget,
  type EditValues
} from '$lib/edits/conflict';
import { t } from '$lib/i18n';
import { writeRecord } from './recordWrite';

/** Thrown inside the edit's transaction so nothing is written (E-04) and
 *  the replay claim is released by `withClientRecordId` (E-06). */
export class EditConflictError extends Error {
  constructor(readonly body: EditConflictBody) {
    super('edit conflict');
    this.name = 'EditConflictError';
  }
}

/** Every in-scope field of a planting as stored now (C-E1). */
export function plantingEditValues(c: Crop): EditValues {
  return {
    varietyDisplayName: c.varietyDisplayName,
    quantityPlanted: c.quantityPlanted ?? null,
    quantityUnit: c.quantityUnit ?? null,
    harvestUseCases: c.harvestUseCases ?? null,
    plantingDate: c.plantingDate ?? null,
    blockId: c.blockId
  };
}

/** Every in-scope field of a task as stored now (C-E1). */
export function taskEditValues(task: Task): EditValues {
  return {
    title: task.title,
    body: task.body ?? null,
    scheduledFor: task.scheduledFor,
    assigneeUserId: task.assigneeUserId ?? null
  };
}

/** Drops fields the request leaves unchanged (`undefined`). */
export function changedValues(values: Record<string, unknown>): EditValues {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(values)) if (v !== undefined) out[k] = v;
  return out as EditValues;
}

interface CheckedEdit<R, T> {
  target: EditTarget;
  id: string;
  action: string;
  base: EditValues | undefined;
  mine: EditValues;
  locale: string | null | undefined;
  /** Re-reads the row inside the transaction; undefined means it is gone. */
  read: () => R | undefined;
  values: (row: R) => EditValues;
  write: (row: R) => T;
}

export type CheckedEditOutcome<T> =
  | { ok: true; value: T }
  | { ok: false; status: 404 }
  | { ok: false; status: 409; body: EditConflictBody };

class EditTargetGone extends Error {}

/** Runs the compare and the write in one `writeRecord` transaction, so two
 *  racing requests cannot both pass the check (E-06). On a conflict nothing
 *  is written. */
export function runCheckedEdit<R, T>(
  event: { request: Request },
  edit: CheckedEdit<R, T>
): CheckedEditOutcome<T> {
  try {
    const value = writeRecord(event, () => {
      const row = edit.read();
      if (row === undefined) throw new EditTargetGone();
      if (edit.base) {
        const current = edit.values(row);
        const fields = editConflicts(edit.base, edit.mine, current);
        if (fields.length > 0) {
          throw new EditConflictError({
            error: t(edit.locale, 'recui.editConflict.error'),
            code: EDIT_CONFLICT_CODE,
            target: edit.target,
            id: edit.id,
            action: edit.action,
            fields,
            current
          });
        }
      }
      return edit.write(row);
    });
    return { ok: true, value };
  } catch (e) {
    if (e instanceof EditConflictError) return { ok: false, status: 409, body: e.body };
    if (e instanceof EditTargetGone) return { ok: false, status: 404 };
    throw e;
  }
}

export function editConflictResponse(body: EditConflictBody): Response {
  return json(body, { status: 409 });
}

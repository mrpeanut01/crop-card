/** Pure rewrite of a refused edit once the farmer picks what to keep
 *  (Phase 36, U-04). Client-safe. */

import {
  EDIT_FIELDS_BY_ACTION,
  sameEditValue,
  type EditConflictBody,
  type EditField,
  type EditValue,
  type EditValues
} from './conflict';

export type EditBody = Record<string, unknown> & { action: string; base: EditValues };

export type ConflictChoice =
  'mine' | 'theirs' | { merge: Partial<Record<EditField, 'mine' | 'theirs'>> };

/** Fields an action can change, keyed `${target}:${action}`. */
export function fieldsFor(target: string, action: string): readonly EditField[] {
  return EDIT_FIELDS_BY_ACTION[`${target}:${action}`] ?? [];
}

/** The in-scope fields the body changes. */
export function touchedFields(target: string, body: EditBody): EditField[] {
  return fieldsFor(target, body.action).filter(
    (f) => Object.hasOwn(body, f) && body[f] !== undefined
  );
}

function currentValue(conflict: EditConflictBody, field: EditField): EditValue {
  return conflict.current[field] ?? null;
}

function rebuildBase(fields: readonly EditField[], conflict: EditConflictBody): EditValues {
  const base: EditValues = {};
  for (const f of fields) base[f] = currentValue(conflict, f);
  return base;
}

/** Fields that must stay in the body even when they change nothing. */
const REQUIRED_FIELDS: Readonly<Record<string, readonly EditField[]>> = {
  'planting:set-schedule': ['plantingDate']
};

/** Returns the body to send again, or null when nothing is left to send.
 *  Keep mine resends every change with `base` set to what is stored now.
 *  Keep theirs drops the edit. Choose for each drops the fields set to
 *  "now on the farm" and keeps the rest; a conflicting field with no choice
 *  is treated as "now on the farm", so nothing is overwritten by accident. */
export function rebaseEdit(
  body: EditBody,
  conflict: EditConflictBody,
  choice: ConflictChoice
): EditBody | null {
  if (choice === 'theirs') return null;
  const target = conflict.target;
  const touched = touchedFields(target, body);
  if (choice === 'mine') {
    if (touched.length === 0) return null;
    return { ...body, base: rebuildBase(touched, conflict) };
  }
  const conflicting = new Set(conflict.fields.map((f) => f.field));
  const required = REQUIRED_FIELDS[`${target}:${body.action}`] ?? [];
  const out: EditBody = { ...body, base: {} };
  const kept: EditField[] = [];
  for (const f of touched) {
    const pick = conflicting.has(f) ? (choice.merge[f] ?? 'theirs') : 'mine';
    if (pick === 'mine') {
      kept.push(f);
      continue;
    }
    if (required.includes(f)) {
      out[f] = currentValue(conflict, f);
      kept.push(f);
    } else {
      delete out[f];
    }
  }
  const changes = kept.some(
    (f) => !sameEditValue(out[f] as EditValue | undefined, currentValue(conflict, f))
  );
  if (!changes) return null;
  out.base = rebuildBase(kept, conflict);
  return out;
}

/** True when every conflicting field has a choice (U-07). */
export function mergeComplete(
  conflict: EditConflictBody,
  merge: Partial<Record<EditField, 'mine' | 'theirs'>>
): boolean {
  return conflict.fields.length > 0 && conflict.fields.every((f) => merge[f.field] !== undefined);
}

/** Keep mine for a direct-manipulation write (a drag, a status button, a
 *  count): the same body with each `base` entry set to what is stored now,
 *  so the next send overwrites the other change on purpose. */
export function keepMineBody<B extends { base?: EditValues }>(
  body: B,
  conflict: EditConflictBody
): B {
  const base: EditValues = {};
  for (const f of Object.keys(body.base ?? {}) as EditField[]) base[f] = currentValue(conflict, f);
  return { ...body, base };
}

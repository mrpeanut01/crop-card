/** Edit-conflict contract shared by the server and the offline queue
 *  (Phase 36, C-E1). Client-safe: no server imports.
 *
 *  An in-scope edit carries `base`, the value of each field it changes as the
 *  device last saw it. The server refuses the whole edit with 409
 *  `EDIT_CONFLICT` when any of those fields has moved on to a third value. */

export const EDIT_CONFLICT_CODE = 'EDIT_CONFLICT' as const;
export type EditTarget = 'planting' | 'task' | 'stock';
export type PlantingEditField =
  | 'varietyDisplayName'
  | 'quantityPlanted'
  | 'quantityUnit'
  | 'harvestUseCases'
  | 'plantingDate'
  | 'blockId'
  | 'status'
  | 'footprint';
export type TaskEditField = 'title' | 'body' | 'scheduledFor' | 'assigneeUserId';
export type StockEditField = 'onHand';
export type EditField = PlantingEditField | TaskEditField | StockEditField;
/** A planting's spot in its bed, in inches (the garden designer's footprint). */
export interface EditFootprint {
  readonly x_in: number;
  readonly y_in: number;
  readonly w_in: number;
  readonly l_in: number;
}
export type EditValue = string | number | null | readonly string[] | EditFootprint;
export type EditValues = Partial<Record<EditField, EditValue>>;
export interface EditConflictField {
  field: EditField;
  base: EditValue;
  mine: EditValue;
  theirs: EditValue;
}
export interface EditConflictBody {
  error: string;
  code: typeof EDIT_CONFLICT_CODE;
  target: EditTarget;
  id: string;
  action: string;
  fields: EditConflictField[];
  current: EditValues;
}

export const PLANTING_EDIT_FIELDS: readonly PlantingEditField[] = [
  'varietyDisplayName',
  'quantityPlanted',
  'quantityUnit',
  'harvestUseCases',
  'plantingDate',
  'blockId',
  'status',
  'footprint'
];
export const TASK_EDIT_FIELDS: readonly TaskEditField[] = [
  'title',
  'body',
  'scheduledFor',
  'assigneeUserId'
];
export const STOCK_EDIT_FIELDS: readonly StockEditField[] = ['onHand'];

/** Appended to the OpenAPI description of every checked action (E-13). */
export const EDIT_CONFLICT_API_NOTE =
  ' Send `base` with the value of each field you change as you last saw it. If someone else has changed one of those fields since, nothing is saved and the answer is 409 with `code: "EDIT_CONFLICT"`, `fields` (each conflicting field with `base`, `mine` and `theirs`) and `current` (every editable field as stored now). A field changed without a `base` entry is not checked.';

/** action key `${target}:${action}` → fields that action can change. */
export const EDIT_FIELDS_BY_ACTION: Readonly<Record<string, readonly EditField[]>> = {
  'planting:edit-details': [
    'varietyDisplayName',
    'quantityPlanted',
    'quantityUnit',
    'harvestUseCases'
  ],
  'planting:set-schedule': ['plantingDate', 'blockId'],
  'task:edit': ['title', 'body'],
  'task:reschedule': ['scheduledFor'],
  'task:assign': ['assigneeUserId'],
  'planting:set-placement': ['blockId', 'footprint', 'plantingDate'],
  'planting:mark-harvested': ['status'],
  'planting:archive': ['status'],
  'planting:mark-failed': ['status'],
  'planting:reactivate': ['status'],
  'stock:set-quantity': ['onHand']
};

const EDIT_FIELD_SET: ReadonlySet<string> = new Set<string>([
  ...PLANTING_EDIT_FIELDS,
  ...TASK_EDIT_FIELDS,
  ...STOCK_EDIT_FIELDS
]);

const FOOTPRINT_KEYS = ['x_in', 'y_in', 'w_in', 'l_in'] as const;

function isFootprint(x: unknown): x is EditFootprint {
  if (!x || typeof x !== 'object' || Array.isArray(x)) return false;
  const o = x as Record<string, unknown>;
  return (
    Object.keys(o).length === FOOTPRINT_KEYS.length &&
    FOOTPRINT_KEYS.every((k) => typeof o[k] === 'number' && Number.isFinite(o[k]))
  );
}

function sortedSet(list: readonly string[]): string[] {
  return [...new Set(list)].sort();
}

export function sameEditValue(a: EditValue | undefined, b: EditValue | undefined): boolean {
  const x = a ?? null;
  const y = b ?? null;
  if (x === null || y === null) return x === y;
  if (isFootprint(x) || isFootprint(y)) {
    if (!isFootprint(x) || !isFootprint(y)) return false;
    return FOOTPRINT_KEYS.every((k) => x[k] === y[k]);
  }
  if (Array.isArray(x) || Array.isArray(y)) {
    if (!Array.isArray(x) || !Array.isArray(y)) return false;
    const sx = sortedSet(x as readonly string[]);
    const sy = sortedSet(y as readonly string[]);
    return sx.length === sy.length && sx.every((v, i) => v === sy[i]);
  }
  return x === y;
}

function has(values: EditValues, field: EditField): boolean {
  return Object.prototype.hasOwnProperty.call(values, field) && values[field] !== undefined;
}

/** The fields of `mine` that conflict. A field is checked only when `mine`
 *  changes it and `base` carries an entry for it; it conflicts when the
 *  stored value differs from both `base` and the requested value. */
export function editConflicts(
  base: EditValues,
  mine: EditValues,
  current: EditValues
): EditConflictField[] {
  const out: EditConflictField[] = [];
  for (const key of Object.keys(mine) as EditField[]) {
    if (!EDIT_FIELD_SET.has(key) || !has(mine, key) || !has(base, key)) continue;
    const b = base[key] as EditValue;
    const m = mine[key] as EditValue;
    const c = current[key] ?? null;
    if (sameEditValue(c, b) || sameEditValue(c, m)) continue;
    out.push({ field: key, base: b, mine: m, theirs: c });
  }
  return out;
}

function isEditValue(x: unknown): x is EditValue {
  if (x === null || typeof x === 'string' || typeof x === 'number') return true;
  if (isFootprint(x)) return true;
  return Array.isArray(x) && x.every((v) => typeof v === 'string');
}

export function isEditConflictBody(x: unknown): x is EditConflictBody {
  if (!x || typeof x !== 'object') return false;
  const o = x as Record<string, unknown>;
  if (o.code !== EDIT_CONFLICT_CODE) return false;
  if (typeof o.error !== 'string' || typeof o.id !== 'string' || typeof o.action !== 'string') {
    return false;
  }
  if (o.target !== 'planting' && o.target !== 'task' && o.target !== 'stock') return false;
  if (!Array.isArray(o.fields)) return false;
  for (const f of o.fields) {
    if (!f || typeof f !== 'object') return false;
    const r = f as Record<string, unknown>;
    if (typeof r.field !== 'string' || !EDIT_FIELD_SET.has(r.field)) return false;
    if (!isEditValue(r.base) || !isEditValue(r.mine) || !isEditValue(r.theirs)) return false;
  }
  if (!o.current || typeof o.current !== 'object' || Array.isArray(o.current)) return false;
  for (const [k, v] of Object.entries(o.current as Record<string, unknown>)) {
    if (!EDIT_FIELD_SET.has(k) || !isEditValue(v)) return false;
  }
  return true;
}

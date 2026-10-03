/** How a conflicting field's value reads in the conflict choice (U-06).
 *  Pure; the component passes the day formatter so dates follow the
 *  viewer's preferences. */

import { t, type MessageKey } from '$lib/i18n';
import { cropDisplayName } from '$lib/i18n/cropName';
import type { EditField, EditValue } from './conflict';

export interface EditDisplayContext {
  locale?: string | null;
  day: (ms: number) => string;
  blockNames?: Readonly<Record<string, string>>;
  useLabels?: Readonly<Record<string, string>>;
  people?: Readonly<Record<string, string>>;
  cropPluginId?: string | null;
}

export const EDIT_FIELD_KEY: Readonly<Record<EditField, MessageKey>> = {
  varietyDisplayName: 'recui.conflict.field.varietyDisplayName',
  quantityPlanted: 'recui.conflict.field.quantityPlanted',
  quantityUnit: 'recui.conflict.field.quantityUnit',
  harvestUseCases: 'recui.conflict.field.harvestUseCases',
  plantingDate: 'recui.conflict.field.plantingDate',
  blockId: 'recui.conflict.field.blockId',
  title: 'recui.conflict.field.title',
  body: 'recui.conflict.field.body',
  scheduledFor: 'recui.conflict.field.scheduledFor',
  assigneeUserId: 'recui.conflict.field.assigneeUserId'
};

export function editFieldLabel(field: EditField, locale?: string | null): string {
  return t(locale, EDIT_FIELD_KEY[field]);
}

function humanizeKey(key: string): string {
  const s = key.replace(/[-_]+/g, ' ').trim();
  return s ? s[0].toUpperCase() + s.slice(1) : key;
}

export function formatEditValue(
  field: EditField,
  value: EditValue | undefined,
  ctx: EditDisplayContext
): string {
  const v = value ?? null;
  if (field === 'harvestUseCases') {
    if (v === null) return t(ctx.locale, 'recui.conflict.allWindows');
    const list = Array.isArray(v) ? (v as readonly string[]) : [String(v)];
    if (list.length === 0) return t(ctx.locale, 'recui.conflict.noWindows');
    return list.map((k) => ctx.useLabels?.[k] ?? humanizeKey(k)).join(', ');
  }
  if (v === null || v === '') return t(ctx.locale, 'recui.conflict.notSet');
  if (field === 'plantingDate' || field === 'scheduledFor') {
    return typeof v === 'number' ? ctx.day(v) : String(v);
  }
  if (field === 'blockId') return ctx.blockNames?.[String(v)] ?? String(v);
  if (field === 'assigneeUserId') {
    return ctx.people?.[String(v)] ?? t(ctx.locale, 'recui.conflict.someoneElse');
  }
  if (field === 'varietyDisplayName') {
    return cropDisplayName(ctx.cropPluginId ?? null, String(v), ctx.locale);
  }
  if (Array.isArray(v)) return v.join(', ');
  return String(v);
}

/**
 * Implement selection for the onboarding wizard. The pickable list is the
 * Phase 9 equipment starter library; this module groups it for display and
 * turns a submitted selection into equipment rows to create.
 *
 * Created rows keep the template's exact type + label because the task
 * engine attaches a template's pre/post tasks by matching those two fields.
 */

export type ImplementType =
  'sprayer' | 'planter' | 'drill' | 'rake' | 'baler' | 'tractor' | 'mower' | 'irrigation' | 'other';

export const IMPLEMENT_TYPES: readonly ImplementType[] = [
  'tractor',
  'sprayer',
  'planter',
  'drill',
  'mower',
  'rake',
  'baler',
  'irrigation',
  'other'
];

export interface ImplementTemplate {
  templateId: string;
  type: ImplementType;
  category: string;
  label: string;
  description: string;
  spec?: Record<string, string | number>;
}

export type ImplementGroupId =
  'tractors' | 'sprayers' | 'tillage' | 'planting' | 'hay' | 'irrigation' | 'more';

export const IMPLEMENT_GROUPS: readonly { id: ImplementGroupId; label: string }[] = [
  { id: 'tractors', label: 'Tractors' },
  { id: 'sprayers', label: 'Sprayers' },
  { id: 'tillage', label: 'Tillage & bed prep' },
  { id: 'planting', label: 'Seeding & transplanting' },
  { id: 'hay', label: 'Mowing & hay' },
  { id: 'irrigation', label: 'Irrigation' },
  { id: 'more', label: 'Spreaders & other tools' }
];

const TILLAGE_RE = /^(tiller|disc|chisel|bed|power-harrow)/;

export function implementGroup(
  t: Pick<ImplementTemplate, 'type' | 'templateId'>
): ImplementGroupId {
  switch (t.type) {
    case 'tractor':
      return 'tractors';
    case 'sprayer':
      return 'sprayers';
    case 'planter':
    case 'drill':
      return 'planting';
    case 'mower':
    case 'rake':
    case 'baler':
      return 'hay';
    case 'irrigation':
      return 'irrigation';
    default:
      return TILLAGE_RE.test(t.templateId) ? 'tillage' : 'more';
  }
}

export function sameImplement(
  a: { type: string; label: string },
  b: { type: string; label: string }
): boolean {
  return a.type === b.type && a.label.trim().toLowerCase() === b.label.trim().toLowerCase();
}

export interface ImplementCreate {
  type: ImplementType;
  label: string;
  spec?: Record<string, unknown>;
}

export interface CustomImplement {
  type: string;
  label: string;
}

/**
 * Resolve a submitted selection into rows to create. Unknown template ids
 * and malformed custom rows are reported, never created. Anything already
 * on the farm (same type + label) is skipped, so resubmitting is harmless.
 */
export function planImplementCreates(
  selectedIds: readonly string[],
  custom: readonly CustomImplement[],
  templates: readonly ImplementTemplate[],
  existing: readonly { type: string; label: string }[]
): { creates: ImplementCreate[]; errors: string[] } {
  const creates: ImplementCreate[] = [];
  const errors: string[] = [];
  const taken = (c: { type: string; label: string }) =>
    existing.some((e) => sameImplement(e, c)) || creates.some((e) => sameImplement(e, c));

  for (const id of new Set(selectedIds)) {
    const t = templates.find((x) => x.templateId === id);
    if (!t) {
      errors.push(`Unknown implement: ${id}`);
      continue;
    }
    if (taken(t)) continue;
    creates.push({
      type: t.type,
      label: t.label,
      spec: { ...(t.spec ?? {}), templateId: t.templateId }
    });
  }

  for (const c of custom) {
    const label = c.label.trim();
    if (!label) continue;
    if (!(IMPLEMENT_TYPES as readonly string[]).includes(c.type)) {
      errors.push(`Unknown implement type for "${label}"`);
      continue;
    }
    if (label.length > 120) {
      errors.push(`"${label.slice(0, 40)}…" is too long (120 characters max)`);
      continue;
    }
    const row = { type: c.type as ImplementType, label };
    if (taken(row)) continue;
    creates.push(row);
  }

  return { creates, errors };
}

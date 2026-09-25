import { error, redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { listEquipment } from '$lib/db/equipment';
import { EQUIPMENT_DOMAIN, listTaxonomyTerms } from '$lib/db/taxonomy';

export const load: PageServerLoad = ({ locals }) => {
  if (!locals.user) throw redirect(303, '/');
  if (locals.user.role !== 'owner') throw error(403, 'owner-only');

  const typeById = new Map(listTaxonomyTerms({ domain: EQUIPMENT_DOMAIN }).map((t) => [t.id, t]));
  const active = listEquipment().filter((e) => e.retiredAt == null);

  const sprayers = active
    .filter((e) => e.type === 'sprayer')
    .map((e) => {
      const { lastChemistryClass, lastUsedAt, lastDeconAt } = e.state;
      return {
        id: e.id,
        label: e.label,
        calibratedGpa: e.state.calibratedGpa ?? null,
        calibrationDate: e.state.calibrationDate ?? null,
        winterizedAt: e.state.winterizedAt ?? null,
        needsDecon: !!(
          lastChemistryClass &&
          lastUsedAt &&
          !(lastDeconAt && lastDeconAt >= lastUsedAt)
        )
      };
    });

  const otherByType = new Map<string, number>();
  for (const e of active) {
    if (e.type === 'sprayer') continue;
    const name = (e.typeId ? typeById.get(e.typeId)?.name : undefined) ?? e.type;
    const key = name.toLowerCase();
    otherByType.set(key, (otherByType.get(key) ?? 0) + 1);
  }

  return {
    total: active.length,
    sprayers,
    otherTypes: [...otherByType.entries()]
      .map(([type, count]) => ({ type, count }))
      .sort((a, b) => a.type.localeCompare(b.type))
  };
};

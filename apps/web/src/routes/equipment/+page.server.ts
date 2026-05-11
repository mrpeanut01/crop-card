import type { PageServerLoad } from './$types';
import { listEquipment } from '$lib/db/equipment';
import { EQUIPMENT_DOMAIN, listTaxonomyTerms } from '$lib/db/taxonomy';

export const load: PageServerLoad = ({ locals }) => {
  const equipment = listEquipment();
  const types = listTaxonomyTerms({ domain: EQUIPMENT_DOMAIN });
  const typeById = new Map(types.map((t) => [t.id, t]));
  // Resolve each row's effective Type label: typeId wins; else legacy enum.
  const equipmentWithType = equipment.map((e) => {
    const tn = e.typeId ? typeById.get(e.typeId)?.name : undefined;
    return { ...e, typeName: tn ?? e.type };
  });
  return {
    equipment: equipmentWithType,
    types,
    canEdit: locals.user?.role === 'owner'
  };
};

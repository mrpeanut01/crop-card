import type { PageServerLoad } from './$types';
import { listEquipment } from '$lib/db/equipment';
import { EQUIPMENT_DOMAIN, listTaxonomyTerms } from '$lib/db/taxonomy';

export const load: PageServerLoad = ({ locals, url }) => {
  const equipment = listEquipment();
  const types = listTaxonomyTerms({ domain: EQUIPMENT_DOMAIN });
  const typeById = new Map(types.map((t) => [t.id, t]));
  // Resolve each row's effective Type label: typeId wins; else legacy enum.
  // #219 — lowercase normalize so taxonomy "Sprayer" + legacy enum "sprayer"
  // collapse into one filter chip instead of two (the counts Map was keying
  // on the raw string and splitting one logical type).
  const equipmentWithType = equipment.map((e) => {
    const tn = e.typeId ? typeById.get(e.typeId)?.name : undefined;
    return { ...e, typeName: (tn ?? e.type).toLowerCase() };
  });
  const canEdit = locals.user?.role === 'owner';
  const addParam = url.searchParams.get('add');
  const addType =
    canEdit && addParam && /^[a-z][a-z -]{0,39}$/i.test(addParam)
      ? (types.find((t) => t.name.toLowerCase() === addParam.toLowerCase())?.name ??
        addParam.charAt(0).toUpperCase() + addParam.slice(1).toLowerCase())
      : null;
  return {
    equipment: equipmentWithType,
    types,
    canEdit,
    addType
  };
};

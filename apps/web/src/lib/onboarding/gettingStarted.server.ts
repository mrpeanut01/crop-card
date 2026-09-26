import { listBlocks, type BlockWithPlantings } from '$lib/db/blocks';
import { listCrops } from '$lib/db/crops';
import { listEquipment } from '$lib/db/equipment';
import { listFields } from '$lib/db/fields';
import { usersForOwner } from '$lib/db/users';
import { isDesignable } from '$lib/farm/areaKinds';
import { getUserAiEnabled } from '$lib/server/aiTry';
import { hasFarmLatLon } from '$lib/schedule/settings';
import type { GettingStartedFacts } from './gettingStarted';
import { getFarmProfile } from './state.server';

function onMap(a: { geometryGeojson?: string; widthFt?: number; lengthFt?: number }): boolean {
  return !!a.geometryGeojson || (a.widthFt != null && a.lengthFt != null);
}

/** Everything the Getting Started card needs for the active Owner, from
 *  tenant-scoped repos. `blocks` can be passed when the caller has it. */
export function loadGettingStartedFacts(input: {
  ownerId: string;
  userId: string;
  blocks?: BlockWithPlantings[];
}): GettingStartedFacts {
  const areas = listFields();
  const blocks = input.blocks ?? listBlocks();
  const equipment = listEquipment().filter((e) => e.retiredAt == null);
  const sprayers = equipment.filter((e) => e.type === 'sprayer');
  const designable = new Set(areas.filter((a) => isDesignable(a.kind)).map((a) => a.id));
  return {
    profile: getFarmProfile(),
    hasLocation: hasFarmLatLon(),
    hasMappedArea: areas.some(onMap) || blocks.some(onMap),
    hasPlanting: blocks.some((b) => b.plantings.length > 0) || listCrops({ limit: 1 }).length > 0,
    hasGardenBed: blocks.some((b) => b.kind === 'bed' && !!b.fieldId && designable.has(b.fieldId)),
    hasEquipment: equipment.length > 0,
    hasSprayer: sprayers.length > 0,
    hasCalibratedSprayer: sprayers.some(
      (s) => s.state.calibratedGpa != null && s.state.calibratedGpa > 0
    ),
    hasHelper: usersForOwner(input.ownerId).some(
      (a) => a.roleWithinOwner !== 'owner' && a.status !== 'revoked'
    ),
    hasAiKey: getUserAiEnabled(input.userId),
    hasPinnedCards: null
  };
}

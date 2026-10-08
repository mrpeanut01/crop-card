import { listBlocks, type BlockWithPlantings } from '$lib/db/blocks';
import { listCrops } from '$lib/db/crops';
import { listEquipment } from '$lib/db/equipment';
import { listFields } from '$lib/db/fields';
import { usersForOwner } from '$lib/db/users';
import { isDesignable } from '$lib/farm/areaKinds';
import { getUserAiEnabled } from '$lib/server/aiTry';
import { hasFarmLatLon } from '$lib/schedule/settings';
import { getSetting, type SettingReader } from '$lib/db/settings';
import { ASSISTANT_SKIPPED_SETTING, type GettingStartedFacts } from './gettingStarted';
import { getFarmAnimals, getFarmProfile } from './state.server';
import { hasAnyAnimalRecord } from '$lib/db/animals';

function onMap(a: { geometryGeojson?: string; widthFt?: number; lengthFt?: number }): boolean {
  return !!a.geometryGeojson || (a.widthFt != null && a.lengthFt != null);
}

/** Everything the Getting Started card needs for the active Owner, from
 *  tenant-scoped repos. Values the caller already read can be passed in. */
export function loadGettingStartedFacts(input: {
  ownerId: string;
  userId: string;
  blocks?: BlockWithPlantings[];
  equipment?: ReturnType<typeof listEquipment>;
  profile?: ReturnType<typeof getFarmProfile>;
  hasLocation?: boolean;
  aiEnabled?: boolean;
  settings?: SettingReader;
}): GettingStartedFacts {
  const read = input.settings ?? getSetting;
  const areas = listFields();
  const blocks = input.blocks ?? listBlocks();
  const equipment = (input.equipment ?? listEquipment()).filter((e) => e.retiredAt == null);
  const sprayers = equipment.filter((e) => e.type === 'sprayer');
  const designableAreas = areas.filter((a) => isDesignable(a.kind));
  const designable = new Set(designableAreas.map((a) => a.id));
  const gardenArea = designableAreas.find((a) => a.kind === 'garden') ?? designableAreas[0] ?? null;
  return {
    profile: input.profile ?? getFarmProfile(read),
    hasLocation: input.hasLocation ?? hasFarmLatLon(),
    hasMappedArea: areas.some(onMap) || blocks.some(onMap),
    hasPlanting: blocks.some((b) => b.plantings.length > 0) || listCrops({ limit: 1 }).length > 0,
    hasGardenBed: blocks.some((b) => b.kind === 'bed' && !!b.fieldId && designable.has(b.fieldId)),
    gardenAreaId: gardenArea?.id ?? null,
    hasEquipment: equipment.length > 0,
    hasSprayer: sprayers.length > 0,
    hasCalibratedSprayer: sprayers.some(
      (s) => s.state.calibratedGpa != null && s.state.calibratedGpa > 0
    ),
    hasHelper: usersForOwner(input.ownerId).some(
      (a) => a.roleWithinOwner !== 'owner' && a.status !== 'revoked'
    ),
    hasAiKey: input.aiEnabled ?? getUserAiEnabled(input.userId),
    assistantSkipped: read(ASSISTANT_SKIPPED_SETTING) === '1',
    hasPinnedCards: null,
    ...animalFacts(read)
  };
}

function animalFacts(
  read: SettingReader
): Pick<GettingStartedFacts, 'animalsAnswered' | 'hasAnimals'> {
  if (getFarmAnimals(read).length === 0) return { animalsAnswered: false, hasAnimals: false };
  return { animalsAnswered: true, hasAnimals: hasAnyAnimalRecord() };
}

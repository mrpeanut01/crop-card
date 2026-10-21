import { listFields } from '$lib/db/fields';
import type { ToxicCrop } from '$lib/animals/toxicAdjacency';
import { HERB_PLUGIN_IDS } from '$lib/garden/herbs';
import { briefPetSpecies } from '$lib/garden/brief/handoff';
import {
  MAX_BRIEF_CHAT_TURNS,
  briefForViewer,
  type GardenBrief,
  type SharedGardenBrief
} from '$lib/garden/brief/schema';
import { getFarmAnimals } from '$lib/onboarding/state.server';
import { lifecycleLine, type LifecycleDetail } from '$lib/garden/lifecycleHere';
import { lifecycleVerdictsFor } from '$lib/server/lifecycleLine.server';
import type { CropPlugin } from '$lib/plugins/schemas';
import { getUserAiEnabled } from '$lib/server/aiTry';
import { getBaseRegistry, getDataKinds, getRegistry } from '$lib/server/registry';
import { loadGardenBrief } from './briefStore';
import type { HerbSunNeed } from '$lib/garden/brief/sun';

export interface BriefHerbOption {
  pluginId: string;
  displayName: string;
  cropFamily: string;
  /** Close-out CO-5: the sourced sun need, when a source states one. */
  sunNeed?: HerbSunNeed;
}

/** The line a shortlist row shows for annual, biennial or perennial here.
 *  Null reads "not yet known"; 37B's verdict fills it at integration. */
export interface BriefLifecycleLine {
  text: string;
  provenance: 'plugin' | 'manual' | 'fallback';
}

export interface BriefPageData {
  /** The owner's brief with its stored conversation; for helpers and
   *  inspectors the brief without it (#870, FU870-3). */
  brief: GardenBrief | SharedGardenBrief | null;
  canEdit: boolean;
  aiEnabled: boolean;
  turnsLeft: number;
  herbs: BriefHerbOption[];
  lifecycle: Record<string, BriefLifecycleLine | null>;
  /** Herbs on the shortlist whose shipped plugin lists animals they harm. */
  toxic: Record<string, ToxicCrop>;
  petSpecies: string[];
  speciesPlural: Record<string, string>;
  /** The first garden (else greenhouse) Area, for "Open the designer". */
  gardenAreaId: string | null;
}

export function briefLifecycleLine(
  verdict: LifecycleDetail | null | undefined,
  locale?: string | null
): BriefLifecycleLine | null {
  if (!verdict) return null;
  return { text: lifecycleLine(verdict, locale), provenance: verdict.provenance };
}

export async function loadBriefPage(
  user: { id: string; role: string },
  locale?: string | null
): Promise<BriefPageData> {
  const canEdit = user.role === 'owner';
  const brief = loadGardenBrief();
  const [registry, base, kinds] = await Promise.all([
    getRegistry(),
    getBaseRegistry(),
    getDataKinds()
  ]);
  const herbs: BriefHerbOption[] = [];
  const plugins = new Map<string, CropPlugin>();
  for (const id of HERB_PLUGIN_IDS) {
    const rec = registry.get(id)?.plugin;
    if (rec?.type !== 'crop') continue;
    const crop = rec as CropPlugin;
    plugins.set(id, crop);
    herbs.push({
      pluginId: id,
      displayName: crop.displayName,
      cropFamily: crop.cropFamily,
      ...(crop.sunNeed ? { sunNeed: crop.sunNeed } : {})
    });
  }
  herbs.sort((a, b) => a.displayName.localeCompare(b.displayName));

  const lifecycle: Record<string, BriefLifecycleLine | null> = {};
  const toxic: Record<string, ToxicCrop> = {};
  const petSpecies = briefPetSpecies(getFarmAnimals());
  const shortlistCrops: CropPlugin[] = [];
  for (const row of brief?.shortlist ?? []) {
    const crop = plugins.get(row.cropPluginId);
    if (!crop) continue;
    shortlistCrops.push(crop);
    if (petSpecies.length === 0) continue;
    const shipped = base.get(row.cropPluginId)?.plugin;
    const toxicity = shipped?.type === 'crop' ? (shipped as CropPlugin).animalToxicity : undefined;
    if (toxicity?.length) {
      toxic[row.cropPluginId] = { pluginId: row.cropPluginId, name: crop.displayName, toxicity };
    }
  }
  const verdicts = await lifecycleVerdictsFor(shortlistCrops);
  for (const crop of shortlistCrops) {
    lifecycle[crop.pluginId] = briefLifecycleLine(verdicts[crop.pluginId], locale);
  }
  const speciesPlural: Record<string, string> = {};
  for (const s of kinds.species.all()) speciesPlural[s.pluginId] = s.tile.label ?? s.displayName;

  const areas = listFields({ kinds: ['garden', 'greenhouse'] });
  const garden = areas.find((a) => a.kind === 'garden') ?? areas[0] ?? null;
  return {
    brief: briefForViewer(brief, user.role),
    canEdit,
    aiEnabled: canEdit && getUserAiEnabled(user.id),
    turnsLeft: Math.max(0, MAX_BRIEF_CHAT_TURNS - (brief?.chatTurns ?? 0)),
    herbs,
    lifecycle,
    toxic,
    petSpecies,
    speciesPlural,
    gardenAreaId: garden?.id ?? null
  };
}

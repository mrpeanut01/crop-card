/**
 * Getting Started card on /today (Phase 30 §5). Pure and client-safe: the
 * loader gathers `GettingStartedFacts` in one pass and this module decides
 * which items show, which are done and how the card renders. The one fact
 * only the device knows (whether any Cards are pinned for offline) arrives
 * as null from the server and is filled in by the page.
 */

import { designerHref } from '$lib/garden/design';
import { t, type MessageKey } from '$lib/i18n';
import { profileIncludesFarm, profileIncludesGarden, type FarmProfile } from './profile';

export interface GettingStartedFacts {
  profile: FarmProfile | null;
  hasLocation: boolean;
  hasMappedArea: boolean;
  hasPlanting: boolean;
  hasGardenBed: boolean;
  /** First garden (else greenhouse) Area, so "Design a garden bed" opens its
   *  designer. Null or missing sends the item to the farm map instead. */
  gardenAreaId?: string | null;
  hasEquipment: boolean;
  hasSprayer: boolean;
  hasCalibratedSprayer: boolean;
  hasHelper: boolean;
  hasAiKey: boolean;
  /** The owner chose to go without the planning assistant. */
  assistantSkipped?: boolean;
  hasPinnedCards: boolean | null;
  /** The owner picked an animal tile on onboarding screen 2 (Phase 32B). */
  animalsAnswered?: boolean;
  /** Any animal or group was ever added, archived or not. */
  hasAnimals?: boolean;
}

/** Per-Owner setting written when the owner skips the planning assistant. */
export const ASSISTANT_SKIPPED_SETTING = 'onboarding_assistant_skipped';

export type GettingStartedItemId =
  | 'location'
  | 'area'
  | 'crop'
  | 'bed'
  | 'animals'
  | 'equipment'
  | 'calibrate'
  | 'helper'
  | 'assistant'
  | 'cards';

export interface GettingStartedItem {
  id: GettingStartedItemId;
  title: string;
  blurb: string;
  href: string;
  done: boolean;
  optional: boolean;
}

export const GETTING_STARTED_HREFS: Record<GettingStartedItemId, string> = {
  location: '/settings/farm',
  area: '/settings/farm/map',
  crop: '/plan',
  bed: '/settings/farm/map',
  animals: '/animals/add',
  equipment: '/equipment',
  calibrate: '/calibrate',
  helper: '/settings/helpers',
  assistant: '/settings/ai/about',
  cards: '/cards'
};

export function gettingStartedItems(
  f: GettingStartedFacts,
  locale?: string | null
): GettingStartedItem[] {
  const garden = profileIncludesGarden(f.profile);
  const farm = profileIncludesFarm(f.profile);
  const item = (id: GettingStartedItemId, done: boolean, optional = false): GettingStartedItem => ({
    id,
    title: t(locale, `gs.${id}.title` as MessageKey),
    blurb: t(locale, `gs.${id}.blurb` as MessageKey),
    href: id === 'bed' && f.gardenAreaId ? designerHref(f.gardenAreaId) : GETTING_STARTED_HREFS[id],
    done,
    optional
  });

  const items: GettingStartedItem[] = [
    item('location', f.hasLocation),
    item('area', f.hasMappedArea),
    item('crop', f.hasPlanting)
  ];
  if (garden) {
    items.push(item('bed', f.hasGardenBed));
  }
  if (f.animalsAnswered) {
    items.push(item('animals', f.hasAnimals === true));
  }
  if (farm) {
    items.push(item('equipment', f.hasEquipment));
  }
  if (f.hasSprayer) {
    items.push(item('calibrate', f.hasCalibratedSprayer));
  }
  if (farm) {
    items.push(item('helper', f.hasHelper, true));
  }
  items.push(
    item('assistant', f.hasAiKey || f.assistantSkipped === true, true),
    item('cards', f.hasPinnedCards === true)
  );
  return items;
}

export interface GettingStartedSummary {
  done: number;
  total: number;
  requiredDone: number;
  requiredTotal: number;
}

export function summarizeGettingStarted(
  items: readonly GettingStartedItem[]
): GettingStartedSummary {
  const required = items.filter((i) => !i.optional);
  return {
    done: items.filter((i) => i.done).length,
    total: items.length,
    requiredDone: required.filter((i) => i.done).length,
    requiredTotal: required.length
  };
}

export type GettingStartedMode = 'full' | 'strip' | 'hidden';

/** Gone for good once dismissed or fully done; a slim strip once the
 *  required items are done; the full card otherwise. */
export function gettingStartedMode(
  s: GettingStartedSummary,
  dismissed: boolean
): GettingStartedMode {
  if (dismissed || s.done === s.total) return 'hidden';
  if (s.requiredDone === s.requiredTotal) return 'strip';
  return 'full';
}

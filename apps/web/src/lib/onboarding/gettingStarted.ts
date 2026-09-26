/**
 * Getting Started card on /today (Phase 30 §5). Pure and client-safe: the
 * loader gathers `GettingStartedFacts` in one pass and this module decides
 * which items show, which are done and how the card renders. The one fact
 * only the device knows (whether any Cards are pinned for offline) arrives
 * as null from the server and is filled in by the page.
 */

import { profileIncludesFarm, profileIncludesGarden, type FarmProfile } from './profile';

export interface GettingStartedFacts {
  profile: FarmProfile | null;
  hasLocation: boolean;
  hasMappedArea: boolean;
  hasPlanting: boolean;
  hasGardenBed: boolean;
  hasEquipment: boolean;
  hasSprayer: boolean;
  hasCalibratedSprayer: boolean;
  hasHelper: boolean;
  hasAiKey: boolean;
  hasPinnedCards: boolean | null;
}

export type GettingStartedItemId =
  | 'location'
  | 'area'
  | 'crop'
  | 'bed'
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
  equipment: '/equipment',
  calibrate: '/calibrate',
  helper: '/settings/helpers',
  assistant: '/settings/ai',
  cards: '/cards'
};

export function gettingStartedItems(f: GettingStartedFacts): GettingStartedItem[] {
  const garden = profileIncludesGarden(f.profile);
  const farm = profileIncludesFarm(f.profile);
  const item = (
    id: GettingStartedItemId,
    title: string,
    blurb: string,
    done: boolean,
    optional = false
  ): GettingStartedItem => ({ id, title, blurb, href: GETTING_STARTED_HREFS[id], done, optional });

  const items: GettingStartedItem[] = [
    item(
      'location',
      'Set your farm location',
      'Weather, frost dates and spray windows all start from here.',
      f.hasLocation
    ),
    item(
      'area',
      'Put your first area on the map',
      'Draw it on the map or just type its size. Either one works.',
      f.hasMappedArea
    ),
    item(
      'crop',
      'Plan your first crop',
      'Pick a crop and where it grows, and the calendar lays out the work.',
      f.hasPlanting
    )
  ];
  if (garden) {
    items.push(
      item(
        'bed',
        'Design a garden bed',
        'Lay out a bed or two so each planting knows where it lives.',
        f.hasGardenBed
      )
    );
  }
  if (farm) {
    items.push(
      item(
        'equipment',
        'Add your equipment',
        'Sprayers, tractors and planters, so their prep and cleanup show up with the work.',
        f.hasEquipment
      )
    );
  }
  if (f.hasSprayer) {
    items.push(
      item(
        'calibrate',
        'Calibrate a sprayer',
        'A five-minute jug-and-stopwatch check so every mix comes out right.',
        f.hasCalibratedSprayer
      )
    );
  }
  if (farm) {
    items.push(
      item(
        'helper',
        'Invite a helper',
        'Give someone who works with you their own sign-in.',
        f.hasHelper,
        true
      )
    );
  }
  items.push(
    item(
      'assistant',
      'Turn on the planning assistant',
      'Adds Claude suggestions to planning. Everything works without it.',
      f.hasAiKey,
      true
    ),
    item(
      'cards',
      'Pin the cards you use most',
      'Open Cards and tap Pin on a card to keep it on this phone for when there is no signal.',
      f.hasPinnedCards === true
    )
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

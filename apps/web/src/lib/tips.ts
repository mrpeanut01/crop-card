/**
 * Beginner tips: one short card at the top of each main screen, shown the
 * first time a new grower opens it. Pure and client-safe. The choice is
 * per user (`users.beginner_tips`); which tips were dismissed lives in the
 * first-use hint store under keys that start `tip_`.
 */

import type { HintKey } from '$lib/hints';
import type { MessageKey } from '$lib/i18n';

export const TIP_IDS = [
  'today',
  'plan',
  'farm_map',
  'designer',
  'spray',
  'scout',
  'harvest',
  'inventory',
  'equipment',
  'calibrate',
  'records',
  'cards',
  'fertility',
  'animals',
  'calendar',
  'site_finder'
] as const;

export type TipId = (typeof TIP_IDS)[number];

/** The public how-to-start guide every tip links to. */
export const START_GUIDE_HREF = '/start';

/** Seen once the Getting Started "Read how to start" link is followed. */
export const START_READ_KEY = 'tip_start_read' satisfies HintKey;

interface TipDef {
  /** A first step on another page, for the people who may take it. */
  action?: { href: string; ownerOnly: boolean };
  /** The page's first step is the owner's, so everyone else reads
   *  `tips.<id>.bodyOther`, which asks for nothing they cannot do. */
  otherBody?: boolean;
}

const TIPS: Record<TipId, TipDef> = {
  today: { action: { href: '/plan', ownerOnly: true }, otherBody: true },
  plan: { otherBody: true },
  farm_map: {},
  designer: { otherBody: true },
  spray: {},
  scout: {},
  harvest: {},
  inventory: { otherBody: true },
  equipment: { otherBody: true },
  calibrate: { otherBody: true },
  records: {},
  cards: {},
  fertility: { otherBody: true },
  animals: { action: { href: '/animals/add', ownerOnly: true }, otherBody: true },
  calendar: { action: { href: '/plan', ownerOnly: true }, otherBody: true },
  site_finder: { otherBody: true }
};

const ROUTE_TIPS: Record<string, TipId> = {
  '/today': 'today',
  '/plan': 'plan',
  '/plan/farm': 'farm_map',
  '/settings/farm/map': 'farm_map',
  '/plan/areas/[id]/design': 'designer',
  '/spray': 'spray',
  '/scout': 'scout',
  '/harvest': 'harvest',
  '/inventory': 'inventory',
  '/equipment': 'equipment',
  '/calibrate': 'calibrate',
  '/records': 'records',
  '/cards': 'cards',
  '/fertility': 'fertility',
  '/animals': 'animals',
  '/plan/calendar': 'calendar',
  '/plan/site-finder': 'site_finder'
};

/** The tip for a route, or null. A page that refused the visitor (the
 *  owner-only map editor) has nothing to teach. */
export function tipForRoute(
  routeId: string | null | undefined,
  data?: { beginnerTips?: boolean; refused?: unknown } | null
): TipId | null {
  if (!routeId || data?.beginnerTips !== true || data.refused) return null;
  return ROUTE_TIPS[routeId] ?? null;
}

export function tipKey(id: TipId): HintKey {
  return `tip_${id}`;
}

export interface TipContent {
  key: HintKey;
  title: MessageKey;
  body: MessageKey;
  action: { href: string; label: MessageKey } | null;
}

/** What a tip says to this role. Only the owner is told to set things up. */
export function tipContent(id: TipId, role: string | null | undefined): TipContent {
  const def = TIPS[id];
  const owner = role === 'owner';
  const action = def.action && (owner || !def.action.ownerOnly) ? def.action : null;
  return {
    key: tipKey(id),
    title: `tips.${id}.title` as MessageKey,
    body: (!owner && def.otherBody ? `tips.${id}.bodyOther` : `tips.${id}.body`) as MessageKey,
    action: action ? { href: action.href, label: `tips.${id}.action` as MessageKey } : null
  };
}

export interface TipVisibility {
  /** `page.data.beginnerTips`: false for "never asked" as well as "no". */
  enabled: boolean | null | undefined;
  key: string;
  /** Dismissed keys from the server (`page.data.seenTips`). */
  serverSeen: readonly string[] | null | undefined;
  /** Dismissed keys known on this device (the hint store). */
  localSeen: ReadonlySet<string>;
  /** A safety stop is on screen; nothing may compete with it. */
  stopOnScreen: boolean;
  /** The page has a reason of its own to hold the tip back. */
  suppressed?: boolean;
}

export function tipVisible(v: TipVisibility): boolean {
  if (v.enabled !== true) return false;
  if (v.suppressed || v.stopOnScreen) return false;
  if (v.localSeen.has(v.key)) return false;
  return !(v.serverSeen ?? []).includes(v.key);
}

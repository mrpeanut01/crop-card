/**
 * Two-screen onboarding (Phase 30). Pure and client-safe: screen 1 creates
 * the farm with its location, screen 2 asks what the owner grows on and
 * seeds one undrawn starter Area per answer. Everything else is a Getting
 * Started item on /today or a just-in-time prompt inside the flow that
 * needs it.
 */

import type { AreaDetails, AreaKind } from '$lib/farm/areaKinds';
import type { FarmProfile } from './profile';

export type OnboardingScreen = 'farm' | 'growing';

export const GROWING_CHOICES = ['garden', 'fields', 'hay', 'greenhouse'] as const;
export type GrowingChoice = (typeof GROWING_CHOICES)[number];

export interface GrowingOption {
  id: GrowingChoice;
  title: string;
  blurb: string;
  starter: StarterArea;
}

export interface StarterArea {
  name: string;
  kind: AreaKind;
  details?: AreaDetails;
}

export const GROWING_OPTIONS: readonly GrowingOption[] = [
  {
    id: 'garden',
    title: 'A garden',
    blurb: 'Beds by the house, vegetables, herbs, a few fruit trees.',
    starter: { name: 'Kitchen Garden', kind: 'garden' }
  },
  {
    id: 'fields',
    title: 'Fields',
    blurb: 'Row crops, grain, market-garden blocks.',
    starter: { name: 'Home Field', kind: 'field' }
  },
  {
    id: 'hay',
    title: 'Hay or pasture',
    blurb: 'Hayfields to cut and bale, or ground for grazing.',
    starter: { name: 'Hayfield', kind: 'pasture', details: { use: 'hay' } }
  },
  {
    id: 'greenhouse',
    title: 'A greenhouse or high tunnel',
    blurb: 'Covered growing space for an early start and a late finish.',
    starter: { name: 'High Tunnel', kind: 'greenhouse', details: { structure: 'high-tunnel' } }
  }
];

/** Steps a bookmark from the old six-step wizard may still carry. */
export const LEGACY_STEP_IDS = ['location', 'fields', 'implements', 'season', 'plan'] as const;

export function isGrowingChoice(v: unknown): v is GrowingChoice {
  return typeof v === 'string' && (GROWING_CHOICES as readonly string[]).includes(v);
}

/** Known choices in canonical order, deduplicated; unknown values dropped. */
export function parseGrowingChoices(raw: readonly unknown[]): GrowingChoice[] {
  const picked = new Set(raw.filter(isGrowingChoice));
  return GROWING_CHOICES.filter((c) => picked.has(c));
}

export function isLegacyStep(v: unknown): boolean {
  return typeof v === 'string' && (LEGACY_STEP_IDS as readonly string[]).includes(v);
}

/**
 * Garden and greenhouse on their own read as a household; fields or hay on
 * their own read as a farm; both is mixed. Nothing picked is no profile.
 */
export function profileForChoices(choices: readonly GrowingChoice[]): FarmProfile | null {
  const household = choices.some((c) => c === 'garden' || c === 'greenhouse');
  const farm = choices.some((c) => c === 'fields' || c === 'hay');
  if (household && farm) return 'mixed';
  if (farm) return 'farm';
  if (household) return 'garden';
  return null;
}

export function starterAreasFor(choices: readonly GrowingChoice[]): StarterArea[] {
  return GROWING_OPTIONS.filter((o) => choices.includes(o.id)).map((o) => ({ ...o.starter }));
}

export type OnboardingRoute =
  | { kind: 'screen'; screen: OnboardingScreen }
  | { kind: 'redirect'; status: 303 | 308; location: string };

/**
 * Where a visit to /onboarding goes. Without a farm it is always screen 1.
 * With one, only an owner whose screen 2 is unanswered stays; a legacy
 * `?step=` bookmark is a permanent redirect to /today so it never breaks.
 */
export function routeOnboarding(input: {
  hasFarm: boolean;
  isOwner: boolean;
  status: string | null;
  step: string | null;
}): OnboardingRoute {
  if (!input.hasFarm) return { kind: 'screen', screen: 'farm' };
  if (isLegacyStep(input.step)) return { kind: 'redirect', status: 308, location: '/today' };
  if (input.isOwner && input.status === 'in-progress') return { kind: 'screen', screen: 'growing' };
  return { kind: 'redirect', status: 303, location: '/today' };
}

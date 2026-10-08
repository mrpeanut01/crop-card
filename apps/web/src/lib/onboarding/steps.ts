/**
 * Two-screen onboarding (Phase 30). Pure and client-safe: screen 1 creates
 * the farm with its location, screen 2 asks what the owner grows on and
 * seeds one undrawn starter Area per answer. Everything else is a Getting
 * Started item on /today or a just-in-time prompt inside the flow that
 * needs it.
 */

import type { AreaDetails, AreaKind } from '$lib/farm/areaKinds';
import { t, type MessageKey } from '$lib/i18n';
import { FARM_ANIMAL_CHOICES, type FarmAnimalChoice, type FarmProfile } from './profile';

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
  nameKey: MessageKey;
  kind: AreaKind;
  details?: AreaDetails;
}

export const GROWING_OPTIONS: readonly GrowingOption[] = [
  {
    id: 'garden',
    title: 'A garden',
    blurb: 'Beds by the house, vegetables, herbs, a few fruit trees.',
    starter: {
      name: 'Kitchen Garden',
      nameKey: 'onboard.starter.kitchenGarden',
      kind: 'garden'
    }
  },
  {
    id: 'fields',
    title: 'Fields',
    blurb: 'Row crops, grain, market-garden blocks.',
    starter: {
      name: 'Home Field',
      nameKey: 'onboard.starter.homeField',
      kind: 'field'
    }
  },
  {
    id: 'hay',
    title: 'Hay or pasture',
    blurb: 'Hayfields to cut and bale, or ground for grazing.',
    starter: {
      name: 'Hayfield',
      nameKey: 'onboard.starter.hayfield',
      kind: 'pasture',
      details: { use: 'hay' }
    }
  },
  {
    id: 'greenhouse',
    title: 'A greenhouse or high tunnel',
    blurb: 'Covered growing space for an early start and a late finish.',
    starter: {
      name: 'High Tunnel',
      nameKey: 'onboard.starter.highTunnel',
      kind: 'greenhouse',
      details: { structure: 'high-tunnel' }
    }
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

/** A starter Area named in the language the owner onboarded in; the name
 *  is stored as typed text from then on. English without a locale. */
function named(s: StarterArea, locale?: string | null): StarterArea {
  return { ...s, name: locale ? t(locale, s.nameKey) : s.name };
}

export function starterAreasFor(
  choices: readonly GrowingChoice[],
  locale?: string | null
): StarterArea[] {
  return GROWING_OPTIONS.filter((o) => choices.includes(o.id)).map((o) => named(o.starter, locale));
}

// ─── Animal tiles (Phase 32B) ────────────────────────────────────────────

export const ANIMAL_CHOICES = FARM_ANIMAL_CHOICES;
export type AnimalChoice = FarmAnimalChoice;

export interface AnimalOption {
  id: AnimalChoice;
  title: string;
  blurb: string;
  /** Pets usually live in the house, so they get no starter Area. */
  starter: StarterArea | null;
}

export const ANIMAL_OPTIONS: readonly AnimalOption[] = [
  {
    id: 'animals',
    title: 'Animals',
    blurb: 'Sheep, goats, cattle, pigs or horses.',
    starter: {
      name: 'Barn',
      nameKey: 'onboard.starter.barn',
      kind: 'barn'
    }
  },
  {
    id: 'pets',
    title: 'Pets',
    blurb: 'Dogs, cats, rabbits and other companions.',
    starter: null
  },
  {
    id: 'chickens',
    title: 'Backyard chickens',
    blurb: 'A few hens or ducks for eggs.',
    starter: {
      name: 'Chicken Coop',
      nameKey: 'onboard.starter.chickenCoop',
      kind: 'coop_pen'
    }
  }
];

export function isAnimalChoice(v: unknown): v is AnimalChoice {
  return typeof v === 'string' && (ANIMAL_CHOICES as readonly string[]).includes(v);
}

export function parseAnimalChoices(raw: readonly unknown[]): AnimalChoice[] {
  const picked = new Set(raw.filter(isAnimalChoice));
  return ANIMAL_CHOICES.filter((c) => picked.has(c));
}

/** The `farm_animals` answer, or null when no animal tile was picked. */
export function farmAnimalsFor(choices: readonly AnimalChoice[]): AnimalChoice[] | null {
  const picked = parseAnimalChoices(choices);
  return picked.length > 0 ? picked : null;
}

/**
 * The profile for both answers. Growing tiles decide it as before. Animals
 * add the farm side, so a garden with animals is mixed. With no growing
 * tile, Animals alone reads as a farm and Pets or Backyard chickens alone
 * read as a household, which keeps compliance chrome folded for them.
 */
export function profileForAnswers(
  growing: readonly GrowingChoice[],
  animals: readonly AnimalChoice[]
): FarmProfile | null {
  const fromGrowing = profileForChoices(growing);
  const farmAnimals = animals.includes('animals');
  if (fromGrowing === 'garden' && farmAnimals) return 'mixed';
  if (fromGrowing) return fromGrowing;
  if (farmAnimals) return 'farm';
  if (animals.length > 0) return 'garden';
  return null;
}

export function starterAreasForAnswers(
  growing: readonly GrowingChoice[],
  animals: readonly AnimalChoice[],
  locale?: string | null
): StarterArea[] {
  const fromAnimals = ANIMAL_OPTIONS.filter((o) => animals.includes(o.id) && o.starter).map((o) =>
    named(o.starter!, locale)
  );
  return [...starterAreasFor(growing, locale), ...fromAnimals];
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

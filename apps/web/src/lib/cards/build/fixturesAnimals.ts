import type { FarmSnapshot } from '../snapshot';
import { sampleSnapshot } from './fixtures';

const at = (iso: string) => Date.parse(iso);

/** June 10, 2026 at midnight in New York, as the kernel rounds a clear. */
export const EGGS_CLEAR_MS = at('2026-06-10T04:00:00Z');
export const MEAT_CLEAR_MS = at('2026-06-20T04:00:00Z');
export const GRAZE_CLEAR_MS = at('2026-06-05T04:00:00Z');

/** The sample farm with a laying flock in the barn, a goat on the
 *  hayfield and a pet dog. Built at 2026-06-01 13:00 UTC. */
export function sampleAnimalSnapshot(overrides: Partial<FarmSnapshot> = {}): FarmSnapshot {
  return sampleSnapshot({
    emergencyContacts: [
      { name: 'Neighbor Ann', role: 'Neighbor', phone: '540-555-0101' },
      { name: 'Dr. Lee', role: '', phone: '540-555-0100', type: 'vet' }
    ],
    species: {
      chicken: {
        pluginId: 'chicken',
        displayName: 'Chicken',
        label: 'Chickens',
        groupNoun: 'flock',
        foodProducingDefault: true,
        products: ['eggs', 'meat']
      },
      goat: {
        pluginId: 'goat',
        displayName: 'Goat',
        label: 'Goats',
        groupNoun: 'herd',
        foodProducingDefault: true,
        products: ['milk', 'meat', 'fiber']
      },
      dog: {
        pluginId: 'dog',
        displayName: 'Dog',
        label: 'Dogs',
        groupNoun: 'group',
        foodProducingDefault: false,
        products: ['companion', 'work']
      }
    },
    animalsLayout: 'farm',
    animalGroups: [
      {
        id: 'g_layers',
        name: 'Layers',
        speciesId: 'chicken',
        purpose: 'production',
        headCount: 20,
        namedCount: 2,
        total: 22,
        foodProducing: true,
        housingFieldId: 'f_barn'
      }
    ],
    animals: [
      {
        id: 'a_hen1',
        groupId: 'g_layers',
        speciesId: 'chicken',
        name: 'Henrietta',
        tag: null,
        sex: 'female',
        breed: null,
        birthDate: null,
        birthDateEstimated: false,
        purpose: 'production',
        foodProducing: true,
        notForSlaughter: false,
        housingFieldId: 'f_barn',
        microchipId: null,
        feedingNote: null
      },
      {
        id: 'a_hen2',
        groupId: 'g_layers',
        speciesId: 'chicken',
        name: 'Clucky',
        tag: null,
        sex: 'female',
        breed: null,
        birthDate: null,
        birthDateEstimated: false,
        purpose: 'production',
        foodProducing: true,
        notForSlaughter: false,
        housingFieldId: 'f_barn',
        microchipId: null,
        feedingNote: null
      },
      {
        id: 'a_goat',
        groupId: null,
        speciesId: 'goat',
        name: 'Nanny',
        tag: 'G-7',
        sex: 'female',
        breed: 'Nubian',
        birthDate: at('2023-04-01T00:00:00Z'),
        birthDateEstimated: true,
        purpose: 'production',
        foodProducing: true,
        notForSlaughter: false,
        housingFieldId: 'f_hay',
        microchipId: null,
        feedingNote: null
      },
      {
        id: 'a_dog',
        groupId: null,
        speciesId: 'dog',
        name: 'Rex',
        tag: null,
        sex: 'neutered-male',
        breed: null,
        birthDate: null,
        birthDateEstimated: false,
        purpose: 'pet',
        foodProducing: false,
        notForSlaughter: false,
        housingFieldId: null,
        microchipId: '985112000123456',
        feedingNote: '2 cups twice a day'
      }
    ],
    carePlans: [
      {
        id: 'cp_mites1',
        subjectType: 'animal',
        subjectId: 'a_hen1',
        kind: 'health-check',
        title: 'Mite check',
        intervalDays: 30,
        nextDueAt: at('2026-06-10T14:00:00Z'),
        provenance: 'manual'
      },
      {
        id: 'cp_mites2',
        subjectType: 'animal',
        subjectId: 'a_hen2',
        kind: 'health-check',
        title: 'Mite check',
        intervalDays: 30,
        nextDueAt: at('2026-06-10T15:00:00Z'),
        provenance: 'manual'
      },
      {
        id: 'cp_flock_deworm',
        subjectType: 'group',
        subjectId: 'g_layers',
        kind: 'deworm',
        title: 'Deworm',
        intervalDays: 90,
        nextDueAt: at('2026-06-03T14:00:00Z'),
        provenance: 'manual'
      },
      {
        id: 'cp_rabies',
        subjectType: 'animal',
        subjectId: 'a_dog',
        kind: 'vaccination',
        title: 'Rabies',
        intervalDays: 365,
        nextDueAt: at('2026-06-15T14:00:00Z'),
        provenance: 'plugin'
      },
      {
        id: 'cp_heartworm',
        subjectType: 'animal',
        subjectId: 'a_dog',
        kind: 'treatment',
        title: 'Heartworm',
        intervalDays: 30,
        nextDueAt: null,
        provenance: 'plugin'
      }
    ],
    treatments: [
      {
        id: 'h_flock',
        subjectType: 'group',
        subjectId: 'g_layers',
        kind: 'deworm',
        productName: 'Flock wormer',
        administeredAt: at('2026-05-30T14:00:00Z'),
        courseEndAt: null
      },
      {
        id: 'h_dog',
        subjectType: 'animal',
        subjectId: 'a_dog',
        kind: 'treatment',
        productName: 'Ear drops',
        administeredAt: at('2026-05-25T14:00:00Z'),
        courseEndAt: at('2026-06-04T14:00:00Z')
      }
    ],
    animalHolds: [
      {
        subject: 'group:g_layers',
        food: 'eggs',
        fromMs: at('2026-05-30T14:00:00Z'),
        clearMs: EGGS_CLEAR_MS,
        status: 'held'
      },
      {
        subject: 'animal:a_hen1',
        food: 'meat',
        fromMs: at('2026-05-30T14:00:00Z'),
        clearMs: MEAT_CLEAR_MS,
        status: 'held'
      },
      {
        subject: 'animal:a_goat',
        food: 'milk',
        fromMs: at('2026-05-28T14:00:00Z'),
        clearMs: null,
        status: 'unknown'
      },
      {
        subject: 'animal:a_goat',
        food: 'milk',
        fromMs: at('2026-05-01T14:00:00Z'),
        clearMs: at('2026-05-10T04:00:00Z'),
        status: 'held'
      }
    ],
    areaHolds: [
      {
        areaId: 'f_hay',
        kind: 'graze',
        fromMs: at('2026-05-29T14:00:00Z'),
        clearMs: GRAZE_CLEAR_MS,
        status: 'held'
      }
    ],
    holdTimeZone: 'America/New_York',
    holdsProjectedTo: at('2026-06-02T14:00:00Z'),
    ...overrides
  });
}

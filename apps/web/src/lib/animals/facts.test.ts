import { describe, expect, it } from 'vitest';
import { animalFacts, groupFacts, type AnimalFactsInput } from './facts';

const cow: AnimalFactsInput = {
  speciesId: 'cattle',
  speciesName: 'Cattle',
  sex: 'female',
  birthDate: null,
  birthDateEstimated: false,
  tag: '14',
  name: 'Daisy',
  breed: 'Jersey',
  acquiredFrom: 'Neighbor',
  purpose: 'production',
  livesAt: 'Red barn',
  groupName: null
};

describe('animalFacts', () => {
  it('shows tag, breed and origin on the farm layout', () => {
    const labels = animalFacts(cow, 'farm').map((f) => f.label);
    expect(labels).toEqual(['Kind', 'Sex', 'Lives at', 'Tag', 'Breed', 'Came from', 'Kept for']);
    expect(animalFacts(cow, 'farm').find((f) => f.label === 'Sex')?.value).toBe('Cow or heifer');
  });

  it('hides farm fields in the pets layout and for a pet on a farm', () => {
    for (const facts of [
      animalFacts(cow, 'pets'),
      animalFacts({ ...cow, speciesId: 'dog', speciesName: 'Dog', purpose: 'pet' }, 'farm')
    ]) {
      const labels = facts.map((f) => f.label);
      expect(labels).not.toContain('Tag');
      expect(labels).not.toContain('Breed');
      expect(labels).not.toContain('Came from');
    }
  });

  it('says where it lives even when unset', () => {
    expect(
      animalFacts({ ...cow, livesAt: null }, 'pets').find((f) => f.label === 'Lives at')
    ).toEqual({ label: 'Lives at', value: 'Not set' });
  });
});

describe('groupFacts', () => {
  it('counts the whole group and splits named from unnamed', () => {
    const facts = groupFacts(
      {
        total: 24,
        headCount: 20,
        namedCount: 4,
        species: { label: 'Chickens', displayName: 'Chicken' },
        purpose: 'production',
        livesAt: 'Hen house'
      },
      'farm'
    );
    expect(facts).toContainEqual({ label: 'How many', value: '24 chickens' });
    expect(facts).toContainEqual({ label: 'Named', value: '4 named, 20 unnamed' });
  });
});

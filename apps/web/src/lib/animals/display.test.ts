import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  ageText,
  animalLabel,
  birthFromAgeYears,
  countText,
  dateInputToMs,
  errorFromResponse,
  housingOptions,
  localInputToMs,
  msToDateInput,
  msToLocalInput,
  newHousingKinds
} from './display';

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 8, 27, 15);

describe('labels and counts', () => {
  it('names an animal by name, then tag', () => {
    expect(animalLabel({ name: 'Daisy', tag: '14' })).toBe('Daisy');
    expect(animalLabel({ name: ' ', tag: '14' })).toBe('Tag 14');
    expect(animalLabel({ name: null, tag: null })).toBe('Unnamed');
  });

  it('counts with the species words', () => {
    const chicken = { label: 'Chickens', displayName: 'Chicken' };
    expect(countText(24, chicken)).toBe('24 chickens');
    expect(countText(1, chicken)).toBe('1 chicken');
    expect(countText(12, { label: 'Sheep', displayName: 'Sheep' })).toBe('12 sheep');
    expect(countText(2, undefined)).toBe('2 animals');
  });
});

describe('ageText', () => {
  it('says "about" only for a guessed birth date', () => {
    expect(ageText(NOW - 3 * 366 * DAY, true, NOW)).toBe('about 3 years');
    expect(ageText(NOW - 3 * 366 * DAY, false, NOW)).toBe('3 years');
  });

  it('uses days, weeks and months for the young', () => {
    expect(ageText(NOW - 1 * DAY, false, NOW)).toBe('1 day');
    expect(ageText(NOW - 21 * DAY, false, NOW)).toBe('3 weeks');
    expect(ageText(NOW - 150 * DAY, false, NOW)).toBe('4 months');
  });

  it('shows nothing without a birth date or for a future one', () => {
    expect(ageText(null, false, NOW)).toBeNull();
    expect(ageText(NOW + DAY, false, NOW)).toBeNull();
  });

  it('round-trips an age in years to "about" that age', () => {
    fc.assert(
      fc.property(fc.integer({ min: 2, max: 30 }), (years) => {
        const born = birthFromAgeYears(years, NOW)!;
        expect(ageText(born, true, NOW)).toBe(`about ${years} years`);
      })
    );
    expect(birthFromAgeYears(-1, NOW)).toBeNull();
    expect(birthFromAgeYears(Number.NaN, NOW)).toBeNull();
  });
});

describe('date inputs', () => {
  it('stores a calendar date at its UTC day', () => {
    expect(dateInputToMs('2024-03-05')).toBe(Date.UTC(2024, 2, 5));
    expect(msToDateInput(Date.UTC(2024, 2, 5))).toBe('2024-03-05');
    expect(dateInputToMs('March 5')).toBeNull();
    expect(msToDateInput(null)).toBe('');
  });

  it('round-trips a local date and time to the minute', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 4_000_000_000_000 }), (ms) => {
        const minute = Math.floor(ms / 60_000) * 60_000;
        expect(localInputToMs(msToLocalInput(minute))).toBe(minute);
      })
    );
    expect(localInputToMs('yesterday')).toBeNull();
  });
});

describe('housing', () => {
  it('drops Areas animals cannot live on and lists barns and coops first', () => {
    const out = housingOptions([
      { id: 'w', name: 'Woods', kind: 'natural_area' },
      { id: 'p', name: 'Pond', kind: 'water' },
      { id: 'b', name: 'Line', kind: 'boundary' },
      { id: 'g', name: 'Garden', kind: 'garden' },
      { id: 'pa', name: 'Back pasture', kind: 'pasture' },
      { id: 'ba', name: 'Red barn', kind: 'barn' },
      { id: 'h', name: 'House', kind: 'residence' }
    ]);
    expect(out.map((a) => a.id)).toEqual(['ba', 'pa', 'g', 'h']);
  });

  it('offers only kinds the farm map knows', () => {
    const kinds = newHousingKinds().map((k) => k.kind);
    expect(kinds).toContain('barn');
    expect(kinds).toContain('pasture');
    expect(kinds).not.toContain('natural_area');
  });
});

describe('errorFromResponse', () => {
  const res = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

  it('turns stable codes into plain words', async () => {
    expect(await errorFromResponse(res(409, { code: 'ANIMAL_HAS_RECORDS', error: 'x' }))).toMatch(
      /Archive it instead/
    );
    expect(await errorFromResponse(res(409, { code: 'SPECIES_MISMATCH' }))).toMatch(/one kind/);
  });

  it('says owner-only on a 403 and falls back to the server text', async () => {
    expect(await errorFromResponse(res(403, { error: 'owner role required' }))).toBe(
      'Only the owner can do that.'
    );
    expect(await errorFromResponse(res(400, { error: 'unknown speciesId' }))).toBe(
      'unknown speciesId'
    );
    expect(await errorFromResponse(new Response('nope', { status: 500 }))).toMatch(/HTTP 500/);
  });
});

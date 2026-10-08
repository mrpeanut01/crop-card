import { describe, expect, it } from 'vitest';
import {
  blockNameMap,
  blockNameOf,
  cropContextLabel,
  cropNamesFor,
  joinSentences
} from './contextLabels';

describe('joinSentences (#639)', () => {
  it('puts a space after the question', () => {
    expect(
      joinSentences(
        'How much are you mixing in this load?',
        '50 gal pull-behind boom sprayer holds 50 gal.'
      )
    ).toBe('How much are you mixing in this load? 50 gal pull-behind boom sprayer holds 50 gal.');
  });

  it('skips missing parts without a trailing space', () => {
    expect(joinSentences('How much?', null)).toBe('How much?');
    expect(joinSentences('', undefined)).toBe('');
  });
});

describe('spray context labels (#673)', () => {
  const names = blockNameMap([
    { id: 'f6034532-0000', name: 'Bed 1' },
    { id: 'b2', name: 'Apple Row' }
  ]);

  it('names a block by its id and never prints the id', () => {
    expect(blockNameOf(names, 'f6034532-0000', 'Removed block')).toBe('Bed 1');
    expect(blockNameOf(names, 'gone-id', 'Removed block')).toBe('Removed block');
    expect(blockNameOf({ x: '  ' }, 'x', 'Removed block')).toBe('Removed block');
  });

  const cropNames = { 'apple-honeycrisp': 'Honeycrisp Apple', tomato: 'Tomato' };

  it('shows the crop name, not the plugin id', () => {
    expect(cropContextLabel(['apple-honeycrisp'], cropNames, 'en', (n) => `${n} crops`)).toBe(
      'Honeycrisp Apple'
    );
    expect(cropContextLabel([], cropNames, 'en', (n) => `${n} crops`)).toBe('—');
    expect(cropContextLabel(['a', 'b'], cropNames, 'en', (n) => `${n} crops`)).toBe('2 crops');
  });

  it('falls back to the id only when the loader has no name', () => {
    expect(cropNamesFor(['tomato', 'mystery'], cropNames, 'en')).toEqual(['Tomato', 'mystery']);
  });

  it('uses the Spanish crop name in Spanish', () => {
    const english = { 'apple-honeycrisp': 'Apple Honeycrisp' };
    expect(cropNamesFor(['apple-honeycrisp'], english, 'es')).toEqual(['Manzana Honeycrisp']);
  });
});

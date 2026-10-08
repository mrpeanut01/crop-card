import { describe, expect, it } from 'vitest';
import { pestOptionsFor, thresholdsFor } from './pestOptions';
import {
  observationLine,
  scoutMetricLabel,
  scoutNoteText,
  scoutPestLabel
} from '$lib/records/metricLabel';

const thresholds = [
  { pest: 'squash bug', metric: 'count-per-plant', threshold: 2, product: 'B' },
  { pest: 'squash bug', metric: 'count-per-plant', threshold: 1, product: 'A' },
  { pest: 'squash bug', metric: 'eggs-per-plant', threshold: 5, product: 'C' },
  { pest: 'aphids', metric: 'count-per-leaf', threshold: 10, product: 'A' }
];

describe('pestOptionsFor (#713)', () => {
  it('puts the crop family scout targets first and dedupes label pests', () => {
    expect(pestOptionsFor(['Squash bug', 'cucumber beetle'], thresholds)).toEqual([
      'Squash bug',
      'cucumber beetle',
      'aphids'
    ]);
  });
});

describe('thresholdsFor (#713)', () => {
  it('matches pest and metric exactly, lowest threshold first', () => {
    expect(
      thresholdsFor(thresholds, ' squash bug ', 'count-per-plant').map((t) => t.product)
    ).toEqual(['A', 'B']);
    expect(thresholdsFor(thresholds, 'Squash bug', 'count-per-plant')).toEqual([]);
    expect(thresholdsFor(thresholds, '', 'count-per-plant')).toEqual([]);
  });
});

describe('scout labels (#731)', () => {
  it('turns app codes into words in English and Spanish', () => {
    expect(scoutPestLabel('broadleaf-weed', 'en')).toBe('Broadleaf weeds');
    expect(scoutPestLabel('broadleaf-weed', 'es')).toBe('Malezas de hoja ancha');
    expect(scoutPestLabel('squash bug', 'es')).toBe('squash bug');
    expect(scoutMetricLabel('avg-per-10sqft', 'en')).toBe('Average per 10 sq ft');
    expect(scoutMetricLabel('eggs-per-plant', 'es')).toBe('Huevos por planta');
  });

  it('keeps the export line byte-identical without a locale', () => {
    expect(observationLine('broadleaf-weed', 'avg-per-10sqft', 1.5, null)).toBe(
      'broadleaf-weed · Average per 10 sq ft: 1.5'
    );
    expect(observationLine('broadleaf-weed', 'avg-per-10sqft', 1.5, null, 'en')).toBe(
      'Broadleaf weeds · Average per 10 sq ft: 1.5'
    );
  });

  it('pulls the typed note out of a counted observation', () => {
    expect(
      scoutNoteText('avg-per-10sqft', 'spots=[1,2,1,2] decision=SKIP note: Aphids on a few heads')
    ).toBe('Aphids on a few heads');
    expect(scoutNoteText('avg-per-10sqft', 'spots=[1] decision=SKIP')).toBeNull();
    expect(scoutNoteText('count-per-plant', 'note: eggs under leaves')).toBe('eggs under leaves');
    expect(scoutNoteText('note', 'Full bloom')).toBe('Full bloom');
    expect(scoutNoteText('note', null)).toBeNull();
  });
});

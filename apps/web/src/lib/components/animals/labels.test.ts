import { describe, expect, it } from 'vitest';
import { createT } from '$lib/i18n';
import { quantityLabel } from './labels';

describe('quantityLabel (#699)', () => {
  it('reads a logged amount in the reader language with its plural', () => {
    const es = createT('es');
    const en = createT('en');
    expect(quantityLabel(es, 18, 'eggs')).toBe('18 huevos');
    expect(quantityLabel(es, 1, 'eggs')).toBe('1 huevo');
    expect(quantityLabel(es, 2.5, 'gal')).toBe('2.5 galones');
    expect(quantityLabel(en, 18, 'eggs')).toBe('18 eggs');
    expect(quantityLabel(en, 1, 'lb')).toBe('1 pound');
    expect(quantityLabel(en, 3, 'dozen')).toBe('3 dozen');
  });

  it('shows an unknown unit as stored', () => {
    expect(quantityLabel(createT('es'), 4, 'bushel')).toBe('4 bushel');
  });
});

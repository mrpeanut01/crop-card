import { describe, expect, it } from 'vitest';
import { en } from './catalogs/en';
import { es } from './catalogs/es';
import { checkCatalog, placeholders } from './check';

describe('i18n catalog check (F5-7)', () => {
  it('passes for the shipped catalogs', () => {
    expect(checkCatalog(en, es)).toEqual([]);
  });

  it('flags a missing translation', () => {
    expect(checkCatalog({ 'a.b': 'Hi' }, {})).toEqual([
      expect.objectContaining({ key: 'a.b', kind: 'missing' })
    ]);
  });

  it('accepts an English-only key with no translation and flags one that has one', () => {
    expect(checkCatalog({ 'safety.stop': 'Stop' }, {})).toEqual([]);
    expect(checkCatalog({ 'safety.stop': 'Stop' }, { 'safety.stop': 'Alto' })).toEqual([
      expect.objectContaining({ key: 'safety.stop', kind: 'english-only-translated' })
    ]);
  });

  it('flags placeholders that differ', () => {
    expect(checkCatalog({ k: 'Hi {name}' }, { k: 'Hola {nombre}' })).toEqual([
      expect.objectContaining({ key: 'k', kind: 'placeholders' })
    ]);
    expect(checkCatalog({ k: '{a} and {b}' }, { k: '{b} y {a}' })).toEqual([]);
  });

  it('flags a translation for a key English does not have', () => {
    expect(checkCatalog({}, { stray: 'x' })).toEqual([
      expect.objectContaining({ key: 'stray', kind: 'unknown-key' })
    ]);
  });

  it('lists placeholders once and sorted', () => {
    expect(placeholders('{b} {a} {b}')).toEqual(['a', 'b']);
  });
});

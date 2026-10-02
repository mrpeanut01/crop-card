// @vitest-environment node
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { enabledLocales, parseEnabledLocales } from './locales';

describe('CROPCARD_LOCALES', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('defaults to English alone', () => {
    expect(parseEnabledLocales(undefined)).toEqual(['en']);
    expect(parseEnabledLocales('')).toEqual(['en']);
  });

  it('keeps known locales, drops unknown ones, and always leads with English', () => {
    expect(parseEnabledLocales('es')).toEqual(['en', 'es']);
    expect(parseEnabledLocales(' ES , en,fr,es ')).toEqual(['en', 'es']);
    expect(parseEnabledLocales('fr,de')).toEqual(['en']);
  });

  it('reads the environment on each call', () => {
    vi.stubEnv('CROPCARD_LOCALES', 'en,es');
    expect(enabledLocales()).toEqual(['en', 'es']);
    vi.stubEnv('CROPCARD_LOCALES', 'en');
    expect(enabledLocales()).toEqual(['en']);
  });

  it('is set to English and Spanish by the Azure template', () => {
    const text = readFileSync(
      new URL('../../../../../infra/azure/main.bicep', import.meta.url),
      'utf8'
    );
    expect(text).toContain("{ name: 'CROPCARD_LOCALES', value: 'en,es' }");
  });
});

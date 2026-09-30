import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { fillHtmlLang, parseAcceptLanguage, resolveLocale } from './resolve';

const BOTH = ['en', 'es'] as const;

describe('parseAcceptLanguage', () => {
  it('orders by quality and keeps the primary subtag', () => {
    expect(parseAcceptLanguage('en-US,en;q=0.9,es-MX;q=0.95')).toEqual(['en', 'es', 'en']);
    expect(parseAcceptLanguage('fr;q=0.2, es')).toEqual(['es', 'fr']);
  });

  it('ignores wildcards, zero quality and junk', () => {
    expect(parseAcceptLanguage('*')).toEqual([]);
    expect(parseAcceptLanguage('es;q=0')).toEqual([]);
    expect(parseAcceptLanguage(null)).toEqual([]);
    expect(parseAcceptLanguage(',,;q=abc')).toEqual([]);
  });
});

describe('resolveLocale (F5-3)', () => {
  it('is always English when only English is enabled', () => {
    fc.assert(
      fc.property(
        fc.option(fc.string()),
        fc.option(fc.string()),
        fc.option(fc.string()),
        (userLocale, cookie, acceptLanguage) =>
          resolveLocale({ enabled: ['en'], userLocale, cookie, acceptLanguage }) === 'en'
      )
    );
    expect(
      resolveLocale({ enabled: ['en'], userLocale: 'es', cookie: 'es', acceptLanguage: 'es' })
    ).toBe('en');
  });

  it('prefers the saved choice, then the cookie, then the browser', () => {
    expect(
      resolveLocale({ enabled: BOTH, userLocale: 'en', cookie: 'es', acceptLanguage: 'es' })
    ).toBe('en');
    expect(resolveLocale({ enabled: BOTH, cookie: 'es', acceptLanguage: 'en' })).toBe('es');
    expect(resolveLocale({ enabled: BOTH, acceptLanguage: 'es-MX,en;q=0.5' })).toBe('es');
    expect(resolveLocale({ enabled: BOTH, acceptLanguage: 'fr,es;q=0.3' })).toBe('es');
    expect(resolveLocale({ enabled: BOTH })).toBe('en');
  });

  it('skips values that are not enabled', () => {
    expect(
      resolveLocale({ enabled: BOTH, userLocale: 'fr', cookie: 'de', acceptLanguage: 'es' })
    ).toBe('es');
  });

  it('only ever returns an enabled locale', () => {
    fc.assert(
      fc.property(
        fc.constantFrom<readonly ('en' | 'es')[]>(['en'], ['en', 'es']),
        fc.option(fc.constantFrom('en', 'es', 'fr', 'ES', '')),
        fc.option(fc.constantFrom('en', 'es', 'xx')),
        fc.option(fc.string()),
        (enabled, userLocale, cookie, acceptLanguage) =>
          enabled.includes(resolveLocale({ enabled, userLocale, cookie, acceptLanguage }))
      )
    );
  });
});

describe('fillHtmlLang', () => {
  it('fills the html lang placeholder with a known locale only', () => {
    expect(fillHtmlLang('<!doctype html>\n<html lang="%lang%">', 'es')).toBe(
      '<!doctype html>\n<html lang="es">'
    );
    expect(fillHtmlLang('<html lang="%lang%">', '"><script>')).toBe('<html lang="en">');
    expect(fillHtmlLang('<p>no shell here</p>', 'es')).toBe('<p>no shell here</p>');
  });
});

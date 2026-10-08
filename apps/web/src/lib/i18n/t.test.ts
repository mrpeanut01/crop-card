import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { en } from './catalogs/en';
import { es, reviewed } from './catalogs/es';
import { createT, t } from './t';
import { isEnglishOnly } from './englishOnly';

describe('t()', () => {
  it('returns the English text for English and for unknown or missing locales', () => {
    expect(t('en', 'nav.today')).toBe('Today');
    expect(t(null, 'nav.today')).toBe('Today');
    expect(t(undefined, 'nav.today')).toBe('Today');
    expect(t('fr', 'nav.today')).toBe('Today');
    expect(t('ES', 'nav.today')).toBe('Today');
  });

  it('uses the Spanish value when there is one', () => {
    expect(t('es', 'nav.today')).toBe('Hoy');
  });

  it('fills placeholders and leaves unknown ones visible', () => {
    expect(t('en', 'account.sessions.lastSignInValue', { time: '9:00 AM' })).toBe(
      'today · 9:00 AM'
    );
    expect(t('en', 'account.sessions.lastSignInValue')).toBe('today · {time}');
  });

  it('picks the plural form from the count', () => {
    expect(t('en', 'nav.pendingRecords', { count: 1 })).toBe('1 offline record waiting to sync');
    expect(t('en', 'nav.pendingRecords', { count: 3 })).toBe('3 offline records waiting to sync');
    expect(t('en', 'nav.pendingRecords', { count: 0 })).toBe('0 offline records waiting to sync');
    expect(t('es', 'nav.alertsActive', { count: 1 })).toBe('Alertas, 1 activa');
    expect(t('es', 'nav.alertsActive', { count: 2 })).toBe('Alertas, 2 activas');
  });

  it('falls back to .other for a plural category the catalog lacks', () => {
    expect(t('es', 'nav.pendingRecords', { count: 1_000_000 })).toContain('registros');
    expect(t('en', 'nav.pendingRecords')).toBe('{count} offline records waiting to sync');
  });

  it('createT binds the locale', () => {
    const tes = createT('es');
    expect(tes('nav.actions')).toBe('Acciones');
    expect(createT('en')('nav.actions')).toBe('Actions');
  });

  it('never returns an empty string for any key in any locale', () => {
    const keys = Object.keys(en) as Array<keyof typeof en>;
    fc.assert(
      fc.property(
        fc.constantFrom(...keys),
        fc.constantFrom('en', 'es', 'xx', null),
        (key, loc) => t(loc, key, { count: 2, time: 'x' }).length > 0
      )
    );
  });

  it('marks the Spanish catalog reviewed', () => {
    expect(reviewed).toBe(true);
  });
});

describe('English-only messages', () => {
  it('covers the safety, spray, decon and hold families', () => {
    for (const key of [
      'safety.stop',
      'kernel.PROHIBITED_DRUG',
      'decon.step1',
      'harvest.stop.title',
      'spray.mixOrder',
      'insecticide.bloom',
      'fungicide.frac',
      'withdrawal.hold',
      'grazing.clear',
      'hold.shorten',
      'label.verbatim'
    ]) {
      expect(isEnglishOnly(key), key).toBe(true);
    }
    for (const key of [
      'email.subject.alert',
      'push.frost.title',
      'digest.card.title',
      'sms.login'
    ]) {
      expect(isEnglishOnly(key), key).toBe(false);
    }
    expect(isEnglishOnly('nav.spray')).toBe(false);
    expect(isEnglishOnly('account.title')).toBe(false);
  });

  it('no Spanish value exists for an English-only key', () => {
    for (const key of Object.keys(es)) expect(isEnglishOnly(key), key).toBe(false);
  });

  it('does not double a sentence period after a value that ends in one (#612)', () => {
    expect(t('es', 'entry.demo.banner', { time: '4:18 p.m.' })).toMatch(/a las 4:18 p\.m\.$/);
    expect(t('en', 'entry.demo.banner', { time: '4:18 PM' })).toMatch(/at 4:18 PM\.$/);
    fc.assert(
      fc.property(fc.string(), fc.boolean(), (v, dot) => {
        const value = dot ? `${v}.` : v;
        const out = t('es', 'entry.demo.banner', { time: value });
        expect(out.endsWith('..') && !value.endsWith('..')).toBe(false);
        expect(out).toContain(value);
      })
    );
  });
});

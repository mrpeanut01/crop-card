import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { atText, atTime, shownHour } from './atTime';
import { t } from './t';
import { scheduleSummary } from '$lib/irrigation/summary';
import { runWhenText, skipWhenText } from '$lib/weather/waterCopy';

const ZONE = 'America/New_York';
const at = (h: number, m = 0) => Date.UTC(2026, 9, 21, h + 4, m);
const NOW = at(0, 30);
const enTime = (ms: number) =>
  new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit', timeZone: ZONE }).format(
    new Date(ms)
  );

describe('atText (#868)', () => {
  it('says "a la" at one o\'clock and "a las" at every other hour', () => {
    expect(atText('1:00 p.m.', 'es')).toBe('a la 1:00 p.m.');
    expect(atText('1:30 a.m.', 'es')).toBe('a la 1:30 a.m.');
    expect(atText('2:00 p.m.', 'es')).toBe('a las 2:00 p.m.');
    expect(atText('12:00 a.m.', 'es')).toBe('a las 12:00 a.m.');
    expect(atText('13:00', 'es')).toBe('a las 13:00');
    expect(atText('0:00', 'es')).toBe('a las 0:00');
    expect(atText('01:00', 'es')).toBe('a la 01:00');
  });

  it('keeps the article in Spanish for the clock style and drops "at" in English', () => {
    expect(atText('1:00', 'es', 'clock')).toBe('a la 1:00');
    expect(atText('6:00', 'es', 'clock')).toBe('a las 6:00');
    expect(atText('1:00', 'en', 'clock')).toBe('1:00');
    expect(atText('1:00', undefined, 'clock')).toBe('1:00');
  });

  it('is "at {time}" in English, and English without a locale', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 23 }), fc.integer({ min: 0, max: 59 }), (h, m) => {
        const time = enTime(at(h, m));
        expect(atText(time, 'en')).toBe(`at ${time}`);
        expect(atText(time)).toBe(`at ${time}`);
        expect(atText(time, 'en', 'clock')).toBe(time);
      })
    );
  });

  it('reads the hour the clock text shows', () => {
    expect(shownHour('1:05 PM')).toBe(1);
    expect(shownHour('10:00 a.m.')).toBe(10);
    expect(shownHour('13:00')).toBe(13);
    expect(Number.isNaN(shownHour('—'))).toBe(true);
    expect(atText('—', 'es')).toBe('a las —');
  });
});

describe('atTime', () => {
  it('formats an instant in the zone, in both languages', () => {
    const es = { timeZone: ZONE, locale: 'es' };
    const en = { timeZone: ZONE, locale: 'en' };
    expect(atTime(at(1), es)).toMatch(/^a la 1:00\sa\.\s?m\.$/);
    expect(atTime(at(13), es)).toMatch(/^a la 1:00\sp\.\s?m\.$/);
    expect(atTime(at(2), es)).toMatch(/^a las 2:00\sa\.\s?m\.$/);
    expect(atTime(at(0), es)).toMatch(/^a las 12:00\sa\.\s?m\.$/);
    for (const h of [0, 1, 2, 13]) expect(atTime(at(h), en)).toBe(`at ${enTime(at(h))}`);
    expect(atTime(at(13), { timeZone: ZONE })).toBe(`at ${enTime(at(13))}`);
  });

  it('reads a stored HH:MM clock value as the timer shows it', () => {
    expect(atTime('01:00', { timeZone: 'UTC', locale: 'es' }, 'clock')).toBe('a la 1:00');
    expect(atTime('13:00', { timeZone: 'UTC', locale: 'es' }, 'clock')).toBe('a las 13:00');
    expect(atTime('00:00', { timeZone: 'UTC', locale: 'es' }, 'clock')).toBe('a las 0:00');
    expect(atTime('06:00', { timeZone: 'UTC', locale: 'en' }, 'clock')).toBe('6:00');
  });
});

describe('callers keep their English byte for byte', () => {
  it('runWhenText and skipWhenText', () => {
    for (const h of [0, 1, 2, 13]) {
      const time = enTime(at(h));
      expect(runWhenText(at(h), NOW, ZONE)).toBe(`today at ${time}`);
      expect(runWhenText(at(h) + 86_400_000, NOW, ZONE, 'en')).toBe(`tomorrow at ${time}`);
      expect(runWhenText(at(h) + 3 * 86_400_000, NOW, ZONE)).toBe(`Sat at ${time}`);
      expect(skipWhenText(at(h), ZONE)).toBe(`Wed, Oct 21 at ${time}`);
    }
  });

  it('scheduleSummary', () => {
    const s = { days: [1, 3, 5], start: '01:00', minutes: 20 };
    expect(scheduleSummary(s)).toBe('Mon, Wed, Fri 1:00 for 20 min');
    expect(scheduleSummary({ ...s, start: '13:00' }, 'en')).toBe('Mon, Wed, Fri 13:00 for 20 min');
  });

  it('the banner, print and forecast lines', () => {
    const time = enTime(at(1));
    const phrase = atTime(at(1), { timeZone: ZONE });
    expect(t('en', 'entry.demo.banner', { at: phrase })).toBe(
      `You're exploring a demo farm. Change anything you like; this copy is yours alone and is cleared at ${time}.`
    );
    expect(t('en', 'cardsui.one.printingCopy', { at: phrase })).toBe(
      `Printing the copy saved at ${time}. Your latest change may not be on it yet.`
    );
    expect(t('en', 'sprayui.fun.fetched', { at: atTime(at(1), { timeZone: ZONE }, 'clock') })).toBe(
      `NWS forecast · fetched ${time}`
    );
  });
});

describe('Spanish callers', () => {
  it("runWhenText at one o'clock and at two", () => {
    expect(runWhenText(at(13) + 86_400_000, NOW, ZONE, 'es')).toMatch(/^mañana a la 1:00/);
    expect(runWhenText(at(14) + 86_400_000, NOW, ZONE, 'es')).toMatch(/^mañana a las 2:00/);
    expect(runWhenText(at(1), NOW, ZONE, 'es')).toMatch(/^hoy a la 1:00/);
    expect(skipWhenText(at(1), ZONE, 'es')).toMatch(/ a la 1:00/);
  });

  it('scheduleSummary', () => {
    const s = { days: [1, 3, 5], start: '01:00', minutes: 20 };
    expect(scheduleSummary(s, 'es')).toMatch(/ a la 1:00 durante 20 min$/);
    expect(scheduleSummary({ ...s, start: '06:00' }, 'es')).toMatch(/ a las 6:00 durante 20 min$/);
    expect(scheduleSummary({ ...s, start: '13:00' }, 'es')).toMatch(/ a las 13:00 durante 20 min$/);
  });

  it('the banner, print and forecast lines', () => {
    const es = { timeZone: ZONE, locale: 'es' };
    expect(t('es', 'entry.demo.banner', { at: atTime(at(1), es) })).toMatch(
      /se borra a la 1:00\sa\.\s?m\.$/
    );
    expect(t('es', 'cardsui.one.printingCopy', { at: atTime(at(14), es) })).toMatch(
      /^Imprimiendo la copia guardada a las 2:00\sp\.\s?m\. Es posible/
    );
    expect(t('es', 'sprayui.fun.fetched', { at: atTime(at(13), es, 'clock') })).toMatch(
      /obtenido a la 1:00\sp\.\s?m\.$/
    );
  });
});

import { describe, expect, it } from 'vitest';
import { enCards } from '$lib/i18n/catalogs/en/cards';
import { buildCard, buildDeck } from './index';
import { buildTaskCard } from './task';
import { allCareTips, FAMILY_CARE_TIPS, familyCareTips } from './careTips';
import { calendarDayLabel, monthName, weekRangeLabel } from './calendar';
import { dueLabel } from './common';
import { sampleSnapshot } from './fixtures';

const prefs = { timeZone: 'America/New_York', units: 'us' as const };
const now = Date.parse('2026-06-04T16:00:00Z');

describe('cards in Spanish', () => {
  it('a task card reads in Spanish when prefs carry the locale', () => {
    const card = buildTaskCard(
      {
        id: 't1',
        title: 'Stake + prune suckers',
        category: 'prune',
        scheduledFor: Date.parse('2026-06-02T14:00:00Z')
      },
      { where: 'Bed 3', asOf: now },
      { now, prefs: { ...prefs, locale: 'es' } }
    );
    expect(card.kicker).toBe('Tarea · Podar');
    expect(card.status?.label).toBe('Atrasada');
    expect(card.facts.map((f) => f.label)).toEqual(['Cuándo', 'Dónde']);
    expect(card.title).toBe('Stake + prune suckers');
  });

  it('an explicit locale wins over prefs, and English stays as it was', () => {
    const es = buildTaskCard(
      { id: 't1', title: 'x', scheduledFor: now },
      { asOf: now },
      { now, prefs, locale: 'es' }
    );
    const en = buildTaskCard({ id: 't1', title: 'x', scheduledFor: now }, { asOf: now }, { now, prefs });
    expect(es.facts[0]).toEqual({ label: 'Cuándo', value: 'Hoy' });
    expect(en.facts[0]).toEqual({ label: 'When', value: 'Today' });
  });

  it('every card the sample farm builds has no raw message keys in Spanish', () => {
    const snapshot = sampleSnapshot();
    const deck = buildDeck(snapshot, { prefs: { ...prefs, locale: 'es' }, now });
    expect(deck.length).toBeGreaterThan(0);
    const text = JSON.stringify(deck);
    expect(text).not.toMatch(/"cards\.[a-zA-Z.-]+"/);
    expect(text).not.toMatch(/\bcards\.(fact|task|area|map|care|tip)\./);
  });

  it('the English deck is unchanged by the locale plumbing', () => {
    const snapshot = sampleSnapshot();
    const plain = buildDeck(snapshot, { prefs, now });
    const en = buildDeck(snapshot, { prefs: { ...prefs, locale: 'en' }, now });
    expect(en).toEqual(plain);
  });

  it('care tips: the catalog English matches the tips table, and Spanish replaces every line', () => {
    for (const [family, tips] of Object.entries(FAMILY_CARE_TIPS)) {
      expect(familyCareTips(family, 'en')).toEqual(tips);
      const es = familyCareTips(family, 'es')!;
      for (const field of ['water', 'feed', 'prune', 'problems'] as const) {
        expect(es[field]).toHaveLength(tips[field].length);
        es[field].forEach((tip, i) => {
          expect(tip.id).toBe(tips[field][i].id);
          expect(tip.text).not.toBe(tips[field][i].text);
        });
      }
      expect(es.label).not.toBe(tips.label);
    }
    expect(familyCareTips('solanaceae')).toBe(FAMILY_CARE_TIPS.solanaceae);
    for (const tip of allCareTips()) {
      expect(enCards[`cards.tip.${tip.id}` as keyof typeof enCards]).toBe(tip.text);
    }
  });

  it('calendar dates follow the locale; English keeps its hand-built form', () => {
    expect(calendarDayLabel('2026-10-05')).toBe('Mon Oct 5');
    expect(calendarDayLabel('2026-10-05', 'en')).toBe('Mon Oct 5');
    expect(calendarDayLabel('2026-10-05', 'es')).not.toBe('Mon Oct 5');
    expect(monthName('2026-10')).toBe('October 2026');
    expect(monthName('2026-10', 'es')).toMatch(/^Octubre/);
    expect(weekRangeLabel('2026-10-04', '2026-10-10')).toBe('Oct 4 to 10');
    expect(weekRangeLabel('2026-10-04', '2026-10-10', 'es')).toMatch(/^4 al 10/);
  });

  it('due labels', () => {
    const at = Date.parse('2026-06-05T16:00:00Z');
    expect(dueLabel(at, now, prefs)).toBe('due tomorrow');
    expect(dueLabel(at, now, { ...prefs, locale: 'es' })).toBe('vence mañana');
  });

  it('a Week Card in Spanish', () => {
    const snapshot = sampleSnapshot();
    const card = buildCard(snapshot, 'wk_2026-06-04', { prefs: { ...prefs, locale: 'es' }, now });
    if (!card) return;
    expect(card.kicker.startsWith('Semana')).toBe(true);
    expect(card.title.startsWith('Semana del')).toBe(true);
  });
});

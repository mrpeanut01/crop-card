import { describe, expect, it } from 'vitest';
import {
  MAX_SHORTLIST,
  briefGoals,
  briefGrowsInPots,
  briefPluginIds,
  emptyBrief,
  gardenBriefChatSchema,
  gardenBriefPutSchema,
  gardenBriefSchema,
  parseGardenBrief,
  snapshotBriefOf,
  unansweredQuestions,
  type GardenBrief
} from './schema';

const row = (id: string) => ({ cropPluginId: id, because: 'x.', provenance: 'fallback' as const });

describe('garden brief schema', () => {
  it('round-trips an empty brief through the stored setting', () => {
    const brief = emptyBrief(1000);
    expect(parseGardenBrief(JSON.stringify(brief))).toEqual(brief);
  });

  it('reads a broken or missing setting as no brief', () => {
    expect(parseGardenBrief(undefined)).toBeNull();
    expect(parseGardenBrief('{not json')).toBeNull();
    expect(parseGardenBrief(JSON.stringify({ version: 2 }))).toBeNull();
  });

  it('fills notSure and provenance on a typed answer', () => {
    const parsed = gardenBriefPutSchema.parse({ answers: { why: { value: ['tea'] } } });
    expect(parsed.answers.why).toEqual({ value: ['tea'], notSure: false, provenance: 'manual' });
  });

  it('refuses unknown answer values, extra keys and a shortlist over 12', () => {
    expect(
      gardenBriefPutSchema.safeParse({ answers: { why: { value: ['fishing'] } } }).success
    ).toBe(false);
    expect(gardenBriefPutSchema.safeParse({ answers: {}, extra: 1 }).success).toBe(false);
    const rows = Array.from({ length: MAX_SHORTLIST + 1 }, (_, i) => row(`herb-${i}`));
    expect(gardenBriefPutSchema.safeParse({ answers: {}, shortlist: rows }).success).toBe(false);
    expect(
      gardenBriefPutSchema.safeParse({ answers: {}, shortlist: rows.slice(0, MAX_SHORTLIST) })
        .success
    ).toBe(true);
  });

  it('refuses a plugin id that is not an id', () => {
    expect(
      gardenBriefPutSchema.safeParse({ answers: { wanted: { value: ['Basil!'] } } }).success
    ).toBe(false);
  });

  it('bounds the chat message and its history', () => {
    expect(gardenBriefChatSchema.safeParse({ message: '' }).success).toBe(false);
    expect(gardenBriefChatSchema.safeParse({ message: 'x'.repeat(1001) }).success).toBe(false);
    const history = Array.from({ length: 17 }, () => ({ role: 'user', text: 'hi' }));
    expect(gardenBriefChatSchema.safeParse({ message: 'hi', history }).success).toBe(false);
  });

  it('caps chat turns at 8', () => {
    expect(gardenBriefSchema.safeParse({ ...emptyBrief(1), chatTurns: 9 }).success).toBe(false);
  });

  it('lists goals in canonical order and carries targets into the snapshot', () => {
    const brief: GardenBrief = {
      ...emptyBrief(5),
      answers: {
        storage: {
          value: [{ goal: 'pesto', target: 'a dozen' }, { goal: 'dry' }],
          notSure: false,
          provenance: 'manual'
        }
      },
      shortlist: [row('basil-genovese')]
    };
    expect(briefGoals(brief)).toEqual(['dry', 'pesto']);
    expect(snapshotBriefOf(brief)).toEqual({
      goals: [{ goal: 'dry' }, { goal: 'pesto', target: 'a dozen' }],
      shortlist: ['basil-genovese'],
      updatedAt: 5
    });
  });

  it('knows pots, ids and unanswered questions', () => {
    const brief: GardenBrief = {
      ...emptyBrief(1),
      answers: {
        where: { value: ['windowsill'], notSure: false, provenance: 'manual' },
        wanted: { value: ['mint-spearmint'], notSure: false, provenance: 'manual' },
        sun: { value: null, notSure: true, provenance: 'manual' }
      },
      shortlist: [row('mint-spearmint'), row('basil-genovese')]
    };
    expect(briefGrowsInPots(brief)).toBe(true);
    expect(briefGrowsInPots(emptyBrief(1))).toBe(false);
    expect(briefPluginIds(brief)).toEqual(['mint-spearmint', 'basil-genovese']);
    expect(unansweredQuestions(brief.answers)).toEqual([
      'why',
      'cuisines',
      'avoid',
      'time',
      'storage'
    ]);
  });
});

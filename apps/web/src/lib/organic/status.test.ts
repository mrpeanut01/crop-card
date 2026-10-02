import { describe, expect, it } from 'vitest';
import {
  entryInForce,
  isUnderOrganic,
  maxEffectiveDay,
  organicChromeLevel,
  organicStatusLine,
  resolveAnimalStatus,
  resolveAreaStatus,
  resolveBlockStatus,
  type EffectiveOrganicStatus,
  type OrganicStatus
} from './status';

const DAY = 86_400_000;
const T0 = Date.UTC(2026, 0, 1);
let n = 0;
function entry(
  status: OrganicStatus,
  day: number,
  createdDay = day,
  certifier: string | null = null
) {
  n += 1;
  return {
    id: `e${String(n).padStart(3, '0')}`,
    status,
    effectiveAt: T0 + day * DAY,
    createdAt: T0 + createdDay * DAY,
    certifier
  };
}
const fmt = (ms: number) => new Date(ms).toISOString().slice(0, 10);

describe('entryInForce', () => {
  it('takes the latest effective date on or before the moment', () => {
    const a = entry('transitioning', 0);
    const b = entry('organic', 30);
    expect(entryInForce([a, b], T0 + 10 * DAY)?.id).toBe(a.id);
    expect(entryInForce([a, b], T0 + 30 * DAY)?.id).toBe(b.id);
    expect(entryInForce([a, b], T0 - DAY)).toBeNull();
  });

  it('resolves same-day entries by the latest saved (B-11)', () => {
    const first = entry('organic', 5, 5);
    const correction = entry('transitioning', 5, 6);
    expect(entryInForce([correction, first], T0 + 5 * DAY)?.status).toBe('transitioning');
  });

  it('does not let a future entry apply yet (B-08)', () => {
    expect(entryInForce([entry('organic', 100)], T0 + 50 * DAY)).toBeNull();
  });
});

describe('resolveBlockStatus (B-09)', () => {
  const area = (entries: ReturnType<typeof entry>[]) => ({
    id: 'f1',
    name: 'North Field',
    entries
  });

  it('inherits the Area entry when the block has none', () => {
    const s = resolveBlockStatus([], area([entry('organic', 0, 0, 'OCIA')]), T0 + DAY);
    expect(s?.status).toBe('organic');
    expect(s?.inheritedFrom).toEqual({
      subjectType: 'field',
      subjectId: 'f1',
      name: 'North Field'
    });
  });

  it('keeps the block override even when the Area entry is later', () => {
    const s = resolveBlockStatus(
      [entry('transitioning', 0)],
      area([entry('organic', 20)]),
      T0 + 40 * DAY
    );
    expect(s?.status).toBe('transitioning');
    expect(s?.inheritedFrom).toBeNull();
  });

  it('shows nothing for a subject with no entry (O-01)', () => {
    expect(resolveBlockStatus([], area([]), T0)).toBeNull();
    expect(resolveBlockStatus([], null, T0)).toBeNull();
    expect(resolveAreaStatus([], T0)).toBeNull();
  });

  it('uses the Area entry before the block entry starts', () => {
    const s = resolveBlockStatus(
      [entry('not-organic', 50)],
      area([entry('organic', 0)]),
      T0 + 10 * DAY
    );
    expect(s?.status).toBe('organic');
  });
});

describe('resolveAnimalStatus (B-10)', () => {
  const groupStatus = (lost = false): EffectiveOrganicStatus => ({
    status: 'organic',
    effectiveAt: T0,
    certifier: null,
    entryId: 'g',
    inheritedFrom: null,
    lost: lost ? { at: T0 + 5 * DAY, healthEventId: 'h1', basis: 'owner-review' } : null
  });

  it('inherits the group status with its name, loss included', () => {
    const s = resolveAnimalStatus(
      [],
      [{ id: 'g1', name: 'Hens', status: groupStatus(true) }],
      null,
      T0 + 9 * DAY
    );
    expect(s?.inheritedFrom).toEqual({ subjectType: 'group', subjectId: 'g1', name: 'Hens' });
    expect(s?.lost?.healthEventId).toBe('h1');
    expect(isUnderOrganic(s)).toBe(false);
  });

  it('own entry wins over the group', () => {
    const s = resolveAnimalStatus(
      [entry('transitioning', 0)],
      [{ id: 'g1', name: 'Hens', status: groupStatus() }],
      null,
      T0 + DAY
    );
    expect(s?.status).toBe('transitioning');
    expect(s?.inheritedFrom).toBeNull();
  });

  it('a later own entry never clears the animal own loss (O-10)', () => {
    const loss = { at: T0 + 5 * DAY, healthEventId: 'h2', basis: 'owner-review' as const };
    const s = resolveAnimalStatus(
      [entry('organic', 0), entry('organic', 40)],
      [],
      loss,
      T0 + 50 * DAY
    );
    expect(s?.lost).toEqual(loss);
    expect(isUnderOrganic(s)).toBe(false);
  });

  it('prefers a lost group when the history is unsure', () => {
    const s = resolveAnimalStatus(
      [],
      [
        { id: 'a', name: 'A', status: groupStatus() },
        { id: 'b', name: 'B', status: groupStatus(true) }
      ],
      null,
      T0 + 9 * DAY
    );
    expect(s?.inheritedFrom?.subjectId).toBe('b');
  });

  it('returns none with no entry and no group status', () => {
    expect(resolveAnimalStatus([], [{ id: 'g', name: 'G', status: null }], null, T0)).toBeNull();
  });
});

describe('organicStatusLine (B-14)', () => {
  const base: EffectiveOrganicStatus = {
    status: 'organic',
    effectiveAt: Date.UTC(2026, 4, 1),
    certifier: 'OCIA',
    entryId: 'e',
    inheritedFrom: null,
    lost: null
  };

  it('always says owner-entered', () => {
    expect(organicStatusLine(base, fmt)).toBe(
      'Organic (owner-entered, effective 2026-05-01, certifier OCIA)'
    );
    expect(organicStatusLine({ ...base, status: 'transitioning', certifier: ' ' }, fmt)).toBe(
      'Transitioning (owner-entered, effective 2026-05-01)'
    );
    expect(organicStatusLine({ ...base, status: 'not-organic', certifier: null }, fmt)).toBe(
      'Not organic (owner-entered, effective 2026-05-01)'
    );
  });

  it('names where an inherited status came from', () => {
    expect(
      organicStatusLine(
        { ...base, inheritedFrom: { subjectType: 'field', subjectId: 'f', name: 'North Field' } },
        fmt
      )
    ).toBe('Organic (owner-entered, effective 2026-05-01, certifier OCIA) from North Field');
    expect(
      organicStatusLine(
        { ...base, inheritedFrom: { subjectType: 'group', subjectId: 'g', name: 'Hens' } },
        fmt
      )
    ).toMatch(/from group Hens$/);
  });

  it('says a loss and never reads as organic', () => {
    const line = organicStatusLine(
      { ...base, lost: { at: Date.UTC(2026, 5, 2), healthEventId: 'h', basis: 'owner-review' } },
      fmt
    );
    expect(line).toMatch(/^Status lost after a treatment on 2026-06-02, as the owner answered\./);
  });

  it('names 205.238(c)(1) when the treated-animal rule ended it', () => {
    const line = organicStatusLine(
      { ...base, lost: { at: Date.UTC(2026, 5, 2), healthEventId: 'h', basis: 'rule' } },
      fmt
    );
    expect(line).toMatch(
      /^Status lost after a treatment on 2026-06-02, under 7 CFR 205\.238\(c\)\(1\)\. Was: .*owner-entered/
    );
    expect(
      organicStatusLine(
        { ...base, lost: { at: Date.UTC(2026, 5, 2), healthEventId: 'h', basis: 'rule' } },
        fmt,
        'es'
      )
    ).toMatch(
      /^Estado perdido tras un tratamiento el 2026-06-02, según 7 CFR 205\.238\(c\)\(1\)\. Antes: /
    );
  });

  it('is null with no status', () => {
    expect(organicStatusLine(null, fmt)).toBeNull();
  });

  it('never uses forbidden words or em dashes (B-57)', () => {
    const line = organicStatusLine(base, fmt) ?? '';
    expect(line).not.toMatch(/certified|compliant|eligible|safe|clear|—/i);
  });
});

describe('organicChromeLevel (B-15)', () => {
  it('is full once any status exists', () => {
    expect(organicChromeLevel({ hasStatusRows: true, profile: 'garden', philosophy: null })).toBe(
      'full'
    );
  });
  it('hides everything for a garden household with no status', () => {
    expect(organicChromeLevel({ hasStatusRows: false, profile: 'garden', philosophy: null })).toBe(
      'none'
    );
    expect(
      organicChromeLevel({ hasStatusRows: false, profile: 'garden', philosophy: 'conventional' })
    ).toBe('none');
  });
  it('opens the door for farms and organic philosophies', () => {
    for (const profile of ['farm', 'mixed', null] as const) {
      expect(organicChromeLevel({ hasStatusRows: false, profile, philosophy: null })).toBe('entry');
    }
    expect(
      organicChromeLevel({
        hasStatusRows: false,
        profile: 'garden',
        philosophy: 'certified-organic'
      })
    ).toBe('entry');
    expect(
      organicChromeLevel({
        hasStatusRows: false,
        profile: 'garden',
        philosophy: 'organic-transitioning'
      })
    ).toBe('entry');
  });
});

describe('maxEffectiveDay', () => {
  it('is one year ahead, clamping Feb 29', () => {
    expect(maxEffectiveDay('2026-10-01')).toBe('2027-10-01');
    expect(maxEffectiveDay('2028-02-29')).toBe('2029-02-28');
  });
});

import { describe, expect, it } from 'vitest';
import { displayFoods, holdChips, isFoodStop, withExposure } from './holdCopy';
import type { FoodHoldSummary } from '$lib/safety/animalWithdrawal';
import type { ExposureVerdict } from '$lib/safety/grazingExposure';
import { locksWhenSaved } from './healthCopy';

const TZ = 'America/New_York';
const clear = { status: 'clear' } as const;

describe('holdChips (C-33)', () => {
  it('shows nothing when every food is clear', () => {
    expect(holdChips({ meat: clear, milk: clear, eggs: clear }, TZ)).toEqual([]);
    expect(holdChips(null, TZ)).toEqual([]);
  });

  it('writes one chip per food on hold, with the clear date', () => {
    const chips = holdChips(
      {
        meat: { status: 'unknown', products: ['Wormer'] },
        milk: clear,
        eggs: {
          status: 'hold',
          clearsAtMs: Date.UTC(2026, 9, 7, 4),
          products: ['Wormer']
        }
      },
      TZ
    );
    expect(chips.map((c) => c.title)).toEqual([
      'HOLD meat: withdrawal not known',
      'HOLD eggs until Wed, Oct 7, 2026'
    ]);
  });

  it('names a banned drug as never for food', () => {
    const [chip] = holdChips(
      {
        meat: clear,
        milk: clear,
        eggs: { status: 'prohibited', products: ['Enrofloxacin'], cfr: ['21 CFR 530.41(a)(10)'] }
      },
      TZ
    );
    expect(chip.title).toBe('Never for food: eggs');
    expect(chip.detail).toContain('21 CFR 530.41(a)(10)');
  });
});

describe('isFoodStop', () => {
  it('accepts every food stop that offers discard and has no override', () => {
    for (const code of [
      'WITHDRAWAL_ACTIVE',
      'WITHDRAWAL_UNKNOWN',
      'PROHIBITED_DRUG',
      'GRAZING_INTERVAL',
      'GRAZING_UNKNOWN',
      'GRAZING_PROHIBITED'
    ]) {
      expect(isFoodStop({ error: 'x', code, resubmitAs: 'discard', overridable: false })).toBe(
        true
      );
    }
    expect(isFoodStop({ error: 'x', code: 'WITHDRAWAL_ACTIVE', resubmitAs: 'discard' })).toBe(
      false
    );
    expect(isFoodStop({ error: 'x', code: 'RECORD_LOCKED' })).toBe(false);
    expect(isFoodStop(null)).toBe(false);
  });
});

describe('locksWhenSaved (C-20)', () => {
  const now = Date.UTC(2026, 8, 27);
  it('flags a hold-bearing record dated more than 48 hours ago', () => {
    expect(locksWhenSaved('deworm', false, now - 49 * 3_600_000, now)).toBe(true);
    expect(locksWhenSaved('vet-visit', true, now - 49 * 3_600_000, now)).toBe(true);
    expect(locksWhenSaved('vet-visit', false, now - 49 * 3_600_000, now)).toBe(false);
    expect(locksWhenSaved('treatment', true, now - 3_600_000, now)).toBe(false);
  });
});

describe('displayFoods (C-33)', () => {
  it('a dog shows no foods, so no hold UI', () => {
    expect(
      displayFoods({ products: ['companion'], foodProducingDefault: false }, null, false)
    ).toEqual([]);
  });
  it('a hen flock shows eggs and meat, never milk', () => {
    expect(
      displayFoods({ products: ['eggs', 'meat'], foodProducingDefault: true }, null, true)
    ).toEqual(['meat', 'eggs']);
  });
  it('a horse still shows meat, and a bull no milk', () => {
    expect(displayFoods({ products: ['work'], foodProducingDefault: true }, 'male', true)).toEqual([
      'meat'
    ]);
    expect(
      displayFoods({ products: ['meat', 'milk'], foodProducingDefault: true }, 'male', true)
    ).toEqual(['meat']);
  });
  it('a pet flipped to food-producing shows meat again', () => {
    expect(displayFoods({ products: [], foodProducingDefault: false }, null, true)).toEqual([
      'meat'
    ]);
  });
});

describe('withExposure', () => {
  const blocked = (clearsAtMs: number | null): ExposureVerdict => ({
    status: 'block',
    reason: clearsAtMs === null ? 'GRAZING_UNKNOWN' : 'GRAZING_INTERVAL',
    food: 'eggs',
    use: 'food',
    clearsAtMs,
    holdEndsAtMs: clearsAtMs ?? 1,
    products: ['Weed Be Gone'],
    holds: [
      {
        fieldId: 'f1',
        ref: 'spray:1',
        productName: 'Weed Be Gone',
        exposedAtMs: 0,
        reason: 'GRAZING_INTERVAL',
        clearsAtMs,
        endsAtMs: clearsAtMs ?? 1
      }
    ],
    message: 'x'
  });

  it('turns a clear food into a dated grazing hold', () => {
    const h = withExposure(clear, blocked(Date.UTC(2026, 9, 7, 4)));
    expect(h).toMatchObject({ status: 'hold', grazed: ['Weed Be Gone'], grazedFieldIds: ['f1'] });
    expect(holdChips({ meat: clear, milk: clear, eggs: h }, TZ)[0].detail).toBe(
      'Grazed where Weed Be Gone was sprayed'
    );
  });
  it('keeps the later of two dates and an unknown beats a date', () => {
    const own: FoodHoldSummary = {
      status: 'hold',
      clearsAtMs: Date.UTC(2026, 9, 20, 4),
      products: ['Wormer']
    };
    expect(withExposure(own, blocked(Date.UTC(2026, 9, 7, 4)))).toMatchObject({
      clearsAtMs: Date.UTC(2026, 9, 20, 4)
    });
    const chip = holdChips(
      { meat: clear, milk: clear, eggs: withExposure(clear, blocked(null)) },
      TZ
    )[0];
    expect(chip).toMatchObject({
      title: 'HOLD eggs: grazing time not known',
      grazingUnknown: true
    });
  });
});

describe('withExposure names which rule has no date (review round 4)', () => {
  const exposure = (clearsAtMs: number | null): ExposureVerdict => ({
    status: 'block',
    reason: clearsAtMs === null ? 'GRAZING_UNKNOWN' : 'GRAZING_INTERVAL',
    food: 'eggs',
    use: 'food',
    clearsAtMs,
    holdEndsAtMs: clearsAtMs ?? 1,
    products: ['Weed Be Gone'],
    holds: [
      {
        fieldId: 'f1',
        ref: 'spray:1',
        productName: 'Weed Be Gone',
        exposedAtMs: 0,
        reason: clearsAtMs === null ? 'GRAZING_UNKNOWN' : 'GRAZING_INTERVAL',
        clearsAtMs,
        endsAtMs: clearsAtMs ?? 1
      }
    ],
    message: 'x'
  });
  const oct20 = Date.UTC(2026, 9, 20, 4);
  const oct7 = Date.UTC(2026, 9, 7, 4);

  it('a known withdrawal with a missing grazing time asks for the grazing time and keeps the date', () => {
    const h = withExposure(
      { status: 'hold', clearsAtMs: oct20, products: ['Wormer'] },
      exposure(null)
    );
    const [chip] = holdChips({ meat: clear, milk: clear, eggs: h }, TZ);
    expect(chip.title).toBe('HOLD eggs: grazing time not known');
    expect(chip.grazingUnknown).toBe(true);
    expect(chip.withdrawalUnknown).toBe(false);
    expect(chip.detail).toContain('held at least until');
    expect(h).toMatchObject({ grazingUnknownFieldIds: ['f1'], knownUntilMs: oct20 });
  });

  it('an unknown withdrawal with a dated grazing hold asks only for the withdrawal', () => {
    const h = withExposure({ status: 'unknown', products: ['Wormer'] }, exposure(oct7));
    const [chip] = holdChips({ meat: clear, milk: clear, eggs: h }, TZ);
    expect(chip.title).toBe('HOLD eggs: withdrawal not known');
    expect(chip.grazingUnknown).toBe(false);
    expect(chip.withdrawalUnknown).toBe(true);
    expect(h).toMatchObject({ knownUntilMs: oct7 });
  });

  it('both unknown asks for both', () => {
    const h = withExposure({ status: 'unknown', products: ['Wormer'] }, exposure(null));
    const [chip] = holdChips({ meat: clear, milk: clear, eggs: h }, TZ);
    expect(chip.title).toBe('HOLD eggs: withdrawal and grazing time not known');
    expect(chip).toMatchObject({ grazingUnknown: true, withdrawalUnknown: true });
  });
});

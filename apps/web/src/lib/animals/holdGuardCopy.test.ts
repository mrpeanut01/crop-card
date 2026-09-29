import { describe, expect, it } from 'vitest';
import {
  correctionTouches,
  enteredLateLabel,
  holdQueueMarker,
  holdShortenMessage,
  type ShortenedHold
} from './holdGuardCopy';

const body = (o: object) => JSON.stringify(o);

describe('holdQueueMarker (C-35 §1: refused queue items stay pending, marked)', () => {
  it('asks for the owner when the guard says so, and for a new date otherwise', () => {
    expect(holdQueueMarker(409, body({ code: 'HOLD_WOULD_SHORTEN', askOwner: true }))).toBe(
      'Owner must enter'
    );
    expect(holdQueueMarker(409, body({ code: 'HOLD_WOULD_SHORTEN', askOwner: false }))).toBe(
      'Change the date'
    );
  });

  it('sends a helper-window backdate to the owner and anything else to a new date', () => {
    expect(holdQueueMarker(422, body({ code: 'BACKDATE_TOO_FAR', windowDays: 1 }))).toBe(
      'Owner must enter'
    );
    expect(holdQueueMarker(422, body({ code: 'BACKDATE_TOO_FAR', windowDays: 7 }))).toBe(
      'Change the date'
    );
    expect(holdQueueMarker(422, body({ code: 'BACKDATE_TOO_FAR', windowDays: 400 }))).toBe(
      'Change the date'
    );
    expect(holdQueueMarker(400, body({ code: 'IN_THE_FUTURE' }))).toBe('Change the date');
    expect(holdQueueMarker(409, body({ code: 'OUT_OF_ORDER' }))).toBe('Change the date');
  });

  it('leaves every other refusal unmarked', () => {
    expect(holdQueueMarker(422, body({ code: 'WITHDRAWAL_ACTIVE' }))).toBeNull();
    expect(holdQueueMarker(409, 'not json')).toBeNull();
    expect(holdQueueMarker(400, body({ error: 'bad' }))).toBeNull();
  });
});

describe('correctionTouches', () => {
  const diff = JSON.stringify({
    holds: [{ key: 'animal:a1', kind: 'milk', lost: [] }],
    coverage: []
  });
  it('finds the subject a void shortened', () => {
    expect(correctionTouches(diff, 'animal:a1')).toBe(true);
    expect(correctionTouches(diff, 'animal:a2')).toBe(false);
    expect(correctionTouches('garbage', 'animal:a1')).toBe(false);
  });
});

describe('enteredLateLabel', () => {
  it('labels a record saved two or more days after its date', () => {
    const day = 86_400_000;
    expect(enteredLateLabel(0, day)).toBeNull();
    expect(enteredLateLabel(0, 3 * day)).toBe('Entered 3 days late');
  });
});

describe('holdShortenMessage (review round 1: writes that carry no date)', () => {
  const hold: ShortenedHold = {
    subject: 'area:p',
    subjectLabel: 'Pasture',
    kind: 'graze',
    clearBefore: Date.UTC(2026, 9, 9, 4),
    clearAfter: null
  };
  const base = { holds: [hold], coverage: [], canVoid: false, askOwner: false };

  it('speaks of the date and offers today only for a dated write', () => {
    const msg = holdShortenMessage({ ...base, todayVersionPasses: true }, 'America/New_York');
    expect(msg).toContain('Saving this with that date would remove Pasture');
    expect(msg).toContain("Save it with today's date instead.");
  });

  it('never mentions a date for a delete, a block move or a correction', () => {
    const msg = holdShortenMessage({ ...base, todayVersionPasses: false }, 'America/New_York');
    expect(msg).toContain("Saving this would remove Pasture's grazing hold");
    expect(msg).not.toContain('that date');
    expect(msg).not.toContain("today's date");
    expect(msg).toContain('Leave the record as it is, or add a note to it.');
  });
});

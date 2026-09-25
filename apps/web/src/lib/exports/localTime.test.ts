import { describe, expect, it } from 'vitest';
import { localDay, localStamp, zoneCaption } from './localTime';

const AT = Date.parse('2026-07-02T01:30:00Z');

describe('export local-time helpers', () => {
  it('renders the stamp in the user zone, not UTC', () => {
    expect(localStamp(AT, { timeZone: 'America/New_York' })).toBe('2026-07-01 21:30');
    expect(localStamp(new Date(AT), { timeZone: 'UTC' })).toBe('2026-07-02 01:30');
    expect(localStamp(AT, { timeZone: 'Asia/Tokyo' })).toBe('2026-07-02 10:30');
  });

  it('takes the day in the user zone', () => {
    expect(localDay(AT, { timeZone: 'America/Los_Angeles' })).toBe('2026-07-01');
    expect(localDay(AT, { timeZone: 'Europe/Berlin' })).toBe('2026-07-02');
  });

  it('returns an empty string for an invalid date', () => {
    expect(localStamp(Number.NaN, { timeZone: 'UTC' })).toBe('');
  });

  it('captions the zone once', () => {
    expect(zoneCaption({ timeZone: 'America/New_York' }, AT)).toBe('EDT · America/New_York');
    expect(zoneCaption({ timeZone: 'America/New_York' }, Date.parse('2026-01-15T12:00:00Z'))).toBe(
      'EST · America/New_York'
    );
    expect(zoneCaption({ timeZone: 'UTC' }, AT)).toBe('UTC');
  });
});

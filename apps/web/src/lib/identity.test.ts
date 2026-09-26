import { describe, expect, it } from 'vitest';
import {
  formatPhone,
  identityLabel,
  identityName,
  normalizePhone,
  parseForChannel,
  parseIdentifier,
  parseSignInChannel
} from './identity';

describe('parseIdentifier', () => {
  it.each([
    ['  Owner@Example.COM ', { kind: 'email', value: 'owner@example.com' }],
    ['571-555-0123', { kind: 'phone', value: '+15715550123' }],
    ['(571) 555 0123', { kind: 'phone', value: '+15715550123' }],
    ['1 571 555 0123', { kind: 'phone', value: '+15715550123' }],
    ['+44 20 7946 0958', { kind: 'phone', value: '+442079460958' }]
  ])('recognises %s', (input, expected) => {
    expect(parseIdentifier(input)).toEqual(expected);
  });

  it.each([
    '',
    'owner@',
    '555-0123',
    '071-555-0123',
    '+0123456789',
    'call me',
    '12345678901234567'
  ])('rejects %s', (input) => {
    expect(parseIdentifier(input)).toBeNull();
  });

  it('rejects non-strings', () => {
    expect(parseIdentifier(42)).toBeNull();
    expect(normalizePhone(null)).toBeNull();
  });
});

describe('labels', () => {
  it('formats US numbers and leaves others as E.164', () => {
    expect(formatPhone('+15715550123')).toBe('(571) 555-0123');
    expect(formatPhone('+442079460958')).toBe('+442079460958');
  });

  it('prefers email, falls back to phone', () => {
    expect(identityLabel({ email: 'a@b.co', phone: '+15715550123' })).toBe('a@b.co');
    expect(identityLabel({ email: null, phone: '+15715550123' })).toBe('(571) 555-0123');
    expect(identityName({ email: 'dale@farm.co', phone: null })).toBe('dale');
    expect(identityName({ email: null, phone: '+15715550123' })).toBe('(571) 555-0123');
    expect(identityName({ email: 'dale@farm.co', phone: null, displayName: 'Dale R.' })).toBe(
      'Dale R.'
    );
    expect(identityName({ email: 'dale@farm.co', phone: null, displayName: null })).toBe('dale');
  });
});

describe('parseSignInChannel', () => {
  it('accepts only the two channels', () => {
    expect(parseSignInChannel('email')).toBe('email');
    expect(parseSignInChannel('phone')).toBe('phone');
    expect(parseSignInChannel('sms')).toBeNull();
    expect(parseSignInChannel(null)).toBeNull();
  });
});

describe('parseForChannel', () => {
  it('reads an email on the email path', () => {
    expect(parseForChannel(' Dale@Farm.CO ', 'email')).toEqual({
      ok: true,
      id: { kind: 'email', value: 'dale@farm.co' }
    });
  });

  it('points a phone typed into the email field at the phone path', () => {
    const r = parseForChannel('(571) 555-0123', 'email');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/Use a phone number instead/);
  });

  it('asks for an email when the email field is junk', () => {
    const r = parseForChannel('dale', 'email');
    expect(r).toEqual({ ok: false, error: 'Enter your email address, like you@example.com.' });
  });

  it('reads a US phone on the phone path', () => {
    expect(parseForChannel('571-555-0123', 'phone')).toEqual({
      ok: true,
      id: { kind: 'phone', value: '+15715550123' }
    });
  });

  it('points an email typed into the phone field back at email', () => {
    const r = parseForChannel('dale@farm.co', 'phone');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/Use email instead/);
  });

  it('asks for a mobile number when the phone field is junk', () => {
    const r = parseForChannel('123', 'phone');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/Enter a mobile number/);
  });

  it('never lets copy carry an em dash', () => {
    for (const [v, c] of [
      ['x', 'email'],
      ['5715550123', 'email'],
      ['x', 'phone'],
      ['a@b.co', 'phone']
    ] as const) {
      const r = parseForChannel(v, c);
      if (!r.ok) expect(r.error).not.toContain('\u2014');
    }
  });
});

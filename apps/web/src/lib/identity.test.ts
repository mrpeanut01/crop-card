import { describe, expect, it } from 'vitest';
import {
  formatPhone,
  identityLabel,
  identityName,
  normalizePhone,
  parseIdentifier
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

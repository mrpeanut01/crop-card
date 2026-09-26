import { describe, expect, it } from 'vitest';
import { inferFirstName, suggestedFarmName } from './names';

describe('inferFirstName', () => {
  it('title-cases the first part of the local part', () => {
    expect(inferFirstName('sherry.miller@hilltop.farm')).toBe('Sherry');
    expect(inferFirstName('DALE_ridge@x.com')).toBe('Dale');
    expect(inferFirstName('marco+farm@x.com')).toBe('Marco');
  });

  it('gives up on addresses with nothing name-like', () => {
    expect(inferFirstName('12345@x.com')).toBeNull();
    expect(inferFirstName('j@x.com')).toBeNull();
    expect(inferFirstName('j2k@x.com')).toBeNull();
    expect(inferFirstName(null)).toBeNull();
    expect(inferFirstName('')).toBeNull();
  });

  it('builds a farm name only from a real first name', () => {
    expect(suggestedFarmName('Sherry')).toBe("Sherry's Farm");
    expect(suggestedFarmName(null)).toBe('');
  });
});

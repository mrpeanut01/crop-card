import { describe, expect, it } from 'vitest';
import { hostRedirectTarget, parseRedirectHosts } from './hostRedirect';

const origin = 'https://app.cropcard.io';
const redirectHosts = parseRedirectHosts('cropcard.io, WWW.cropcard.io,');
const url = (p: string) => new URL(p, 'http://internal');

describe('parseRedirectHosts', () => {
  it('lowercases, trims and drops empties', () => {
    expect([...redirectHosts]).toEqual(['cropcard.io', 'www.cropcard.io']);
  });

  it('is empty when unset', () => {
    expect(parseRedirectHosts(undefined).size).toBe(0);
  });
});

describe('hostRedirectTarget', () => {
  it('sends the apex and www to ORIGIN keeping path and query', () => {
    for (const host of ['cropcard.io', 'www.cropcard.io', 'WWW.CropCard.io:443']) {
      expect(
        hostRedirectTarget({ host, url: url('/records?year=2026'), redirectHosts, origin })
      ).toBe('https://app.cropcard.io/records?year=2026');
    }
  });

  it('leaves the canonical host, the ACA default host and unknown hosts alone', () => {
    for (const host of [
      'app.cropcard.io',
      'cropcard-dev-app.lemondesert-1f8b56e6.eastus2.azurecontainerapps.io',
      'evil.example',
      null
    ]) {
      expect(hostRedirectTarget({ host, url: url('/'), redirectHosts, origin })).toBeNull();
    }
  });

  it('never redirects to itself when ORIGIN is one of the listed hosts', () => {
    expect(
      hostRedirectTarget({
        host: 'cropcard.io',
        url: url('/'),
        redirectHosts,
        origin: 'https://cropcard.io'
      })
    ).toBeNull();
  });

  it('does nothing without ORIGIN, a valid ORIGIN or a host list', () => {
    const base = { host: 'cropcard.io', url: url('/') };
    expect(hostRedirectTarget({ ...base, redirectHosts, origin: undefined })).toBeNull();
    expect(hostRedirectTarget({ ...base, redirectHosts, origin: 'not a url' })).toBeNull();
    expect(
      hostRedirectTarget({ ...base, redirectHosts: parseRedirectHosts(''), origin })
    ).toBeNull();
  });

  it('keeps the target on ORIGIN for scheme-relative paths', () => {
    expect(
      hostRedirectTarget({
        host: 'cropcard.io',
        url: url('//evil.example/x'),
        redirectHosts,
        origin
      })
    ).toMatch(/^https:\/\/app\.cropcard\.io\//);
  });
});

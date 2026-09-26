import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { complianceChromeLevel } from './complianceChrome';

const none = { sprays: 0, insecticides: 0, fungicides: 0 };

describe('complianceChromeLevel', () => {
  it('is quiet only for a garden profile with no pesticide records', () => {
    expect(complianceChromeLevel('garden', none)).toBe('quiet');
  });

  it('is full for any other profile, including unknown', () => {
    expect(complianceChromeLevel('farm', none)).toBe('full');
    expect(complianceChromeLevel('mixed', none)).toBe('full');
    expect(complianceChromeLevel(null, none)).toBe('full');
  });

  it('goes full on the first pesticide record of any kind', () => {
    expect(complianceChromeLevel('garden', { ...none, sprays: 1 })).toBe('full');
    expect(complianceChromeLevel('garden', { ...none, insecticides: 1 })).toBe('full');
    expect(complianceChromeLevel('garden', { ...none, fungicides: 1 })).toBe('full');
  });

  it('is quiet only when every count is zero', () => {
    const n = fc.nat({ max: 50 });
    fc.assert(
      fc.property(
        fc.constantFrom('garden', 'farm', 'mixed', null),
        n,
        n,
        n,
        (profile, sprays, insecticides, fungicides) => {
          const level = complianceChromeLevel(profile, { sprays, insecticides, fungicides });
          const quiet = profile === 'garden' && sprays + insecticides + fungicides === 0;
          expect(level).toBe(quiet ? 'quiet' : 'full');
        }
      )
    );
  });
});

describe('enforcement never reads the farm profile', () => {
  const src = resolve(__dirname, '..', '..');
  function walk(dir: string): string[] {
    return readdirSync(dir).flatMap((name) => {
      const p = join(dir, name);
      return statSync(p).isDirectory() ? walk(p) : [p];
    });
  }
  const enforcement = [
    'lib/safety',
    'lib/dilution',
    'lib/server/seasonClose.ts',
    'lib/db/sprayEvents.ts',
    'lib/db/insecticideEvents.ts',
    'lib/db/fungicideEvents.ts',
    'routes/api/spray',
    'routes/api/insecticide',
    'routes/api/fungicide',
    'routes/api/records'
  ];

  it('no safety, lock, retention or export module mentions the profile or this helper', () => {
    const files = enforcement
      .map((p) => join(src, p))
      .flatMap((p) => {
        return statSync(p).isDirectory() ? walk(p) : [p];
      })
      .filter((f) => /\.(ts|svelte)$/.test(f) && !f.endsWith('.test.ts'));
    expect(files.length).toBeGreaterThan(20);
    for (const f of files) {
      const body = readFileSync(f, 'utf8');
      expect(body, f).not.toMatch(/farm_profile|onboarding\/profile|complianceChrome/);
    }
  });
});

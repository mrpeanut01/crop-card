import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { en } from '$lib/i18n/catalogs/en';
import { es } from '$lib/i18n/catalogs/es';
import { MOW_TRIGGER_KEYS, mowTriggerText } from './mowTriggerText';

const CROPS_DIR = resolve(__dirname, '../../../../../plugins/crops');
const triggers = readdirSync(CROPS_DIR)
  .filter((f) => f.endsWith('.json'))
  .map((f) => JSON.parse(readFileSync(resolve(CROPS_DIR, f), 'utf8')))
  .map((p) => p.hayOperations?.mowTrigger as string | undefined)
  .filter((x): x is string => typeof x === 'string');

describe('mowTriggerText', () => {
  it('has a Spanish cue for every shipped mow trigger', () => {
    expect(triggers.length).toBeGreaterThan(0);
    for (const cue of new Set(triggers)) {
      const key = MOW_TRIGGER_KEYS[cue];
      expect(key, cue).toBeTruthy();
      expect((en as Record<string, string>)[key]).toBe(cue);
      expect((es as Record<string, string | undefined>)[key], cue).toBeTruthy();
    }
  });

  it('keeps English as written and translates only shipped cues', () => {
    expect(mowTriggerText('1/4 to 1/2 bloom')).toBe('1/4 to 1/2 bloom');
    expect(mowTriggerText('1/4 to 1/2 bloom', 'es')).toBe('de 1/4 a 1/2 de floración');
    expect(mowTriggerText('When I feel like it', 'es')).toBe('When I feel like it');
  });
});

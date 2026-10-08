import { describe, expect, it } from 'vitest';
import { SEED_EQUIPMENT_TEMPLATES } from '$lib/server/equipmentTemplates';
import { en } from '$lib/i18n/catalogs/en';
import { es } from '$lib/i18n/catalogs/es';
import { templateMessageKey, templateText, type TemplatePart } from './templateText';

const PARTS: TemplatePart[] = ['category', 'label', 'description'];
const EN = en as Record<string, string | undefined>;
const ES = es as Record<string, string | undefined>;

describe('equipment template text', () => {
  it('keeps the English catalog equal to the starter library, with Spanish for every part', () => {
    for (const tpl of SEED_EQUIPMENT_TEMPLATES) {
      for (const part of PARTS) {
        const key = templateMessageKey(tpl.templateId, part);
        expect(EN[key], key).toBe(tpl[part]);
        expect(ES[key], key).toBeTruthy();
      }
    }
  });

  it('returns the English unchanged without a locale or in English', () => {
    expect(templateText('sprayer-backpack-4gal', 'category', 'Backpack sprayer')).toBe(
      'Backpack sprayer'
    );
    expect(templateText('sprayer-backpack-4gal', 'category', 'Backpack sprayer', 'en')).toBe(
      'Backpack sprayer'
    );
  });

  it('translates shipped text and leaves changed or unknown text as given', () => {
    expect(templateText('sprayer-backpack-4gal', 'category', 'Backpack sprayer', 'es')).toBe(
      'Aspersora de mochila'
    );
    expect(templateText('sprayer-backpack-4gal', 'label', 'My old sprayer', 'es')).toBe(
      'My old sprayer'
    );
    expect(templateText('no-such-template', 'label', 'Thing', 'es')).toBe('Thing');
  });
});

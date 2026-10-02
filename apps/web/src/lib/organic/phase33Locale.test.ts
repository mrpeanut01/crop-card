import { describe, expect, it } from 'vitest';
import { createT } from '$lib/i18n';
import { enAmend } from '$lib/i18n/catalogs/en/amend';
import { organicUseFactLine } from './animalStatus';
import { organicWriteRefusal } from './access.server';
import { dispositionIssueText } from '$lib/harvest/apiSchemas';
import {
  ALL_GUIDE_SENTENCES,
  BIOASSAY_DAMAGE,
  guideSentenceText
} from '$lib/amendments/bioassayGuide';
import { localizeDocCopy } from '$lib/components/documents/labels';

// Phase 34B (#510): the Phase 33 helpers that moved onto the catalog keep
// their English byte for byte without a locale and change in Spanish.

const RAW_KEY = /\b(?:organic|harvestui|amend|docs)\.[A-Za-z]/;

describe('organicUseFactLine', () => {
  const withConditions = {
    status: 'allowed-with-conditions' as const,
    citation: '7 CFR 205.603(a)',
    conditions: 'Only in an emergency'
  };
  const allowed = { status: 'allowed' as const, citation: '7 CFR 205.603(b)' };

  it('stays the pinned English without a locale', () => {
    expect(organicUseFactLine(withConditions)).toBe(
      'Library entry: allowed for organic use with conditions (7 CFR 205.603(a)). Conditions: Only in an emergency. This is a fact to weigh, not the answer.'
    );
    expect(organicUseFactLine(allowed)).toBe(
      'Library entry: allowed for organic use (7 CFR 205.603(b)). This is a fact to weigh, not the answer.'
    );
  });

  it('the English catalog reads the same as the literal', () => {
    expect(organicUseFactLine(withConditions, 'en')).toBe(organicUseFactLine(withConditions));
    expect(organicUseFactLine(allowed, 'en')).toBe(organicUseFactLine(allowed));
  });

  it('translates the sentence and keeps the citation and conditions as written', () => {
    const es = organicUseFactLine(withConditions, 'es');
    expect(es).not.toBe(organicUseFactLine(withConditions));
    expect(es).toContain('7 CFR 205.603(a)');
    expect(es).toContain('Only in an emergency');
    expect(es).not.toMatch(RAW_KEY);
    expect(organicUseFactLine(allowed, 'es')).not.toContain('Condiciones');
  });
});

describe('organicWriteRefusal', () => {
  async function message(res: Response | null): Promise<string> {
    return ((await res?.json()) as { message: string }).message;
  }

  it('keeps the English refusals without a locale', async () => {
    expect(await message(organicWriteRefusal({ role: 'helper', impersonating: false }))).toBe(
      'Only the owner can enter organic statuses and reviews.'
    );
    expect(await message(organicWriteRefusal({ role: 'owner', impersonating: true }))).toBe(
      'Organic statuses cannot be entered while impersonating a farm.'
    );
    expect(organicWriteRefusal({ role: 'owner', impersonating: false })).toBeNull();
  });

  it('answers in Spanish with the same codes', async () => {
    const res = organicWriteRefusal({ role: 'helper', impersonating: false }, 'es');
    const body = (await res?.json()) as { error: string; message: string };
    expect(body.error).toBe('OWNER_ONLY');
    expect(body.message).toMatch(/dueño/);
    expect(body.message).not.toMatch(RAW_KEY);
  });
});

describe('dispositionIssueText', () => {
  it('keeps the schema English without a locale', () => {
    expect(dispositionIssueText([{ message: 'Only a sale or a gift has a recipient.' }])).toBe(
      'Only a sale or a gift has a recipient.'
    );
    expect(dispositionIssueText([])).toBe('Check the fields and try again.');
  });

  it('translates the known problems and falls back to "check the fields"', () => {
    const es = dispositionIssueText(
      [{ message: 'Only a sale can be marked sold as organic.' }],
      'es'
    );
    expect(es).toMatch(/orgánica/);
    expect(dispositionIssueText([{ message: 'Expected number' }], 'es')).toBe(
      createT('es')('harvestui.disp.err.checkFields')
    );
    expect(
      dispositionIssueText([{ message: 'Only a sale or a gift has a recipient.' }], 'en')
    ).toBe('Only a sale or a gift has a recipient.');
  });
});

describe('bioassay guide sentences', () => {
  const shown = ALL_GUIDE_SENTENCES.filter((s) => s !== BIOASSAY_DAMAGE);

  it('the catalog English is the sourced text, word for word', () => {
    for (const s of shown) {
      expect(enAmend[`amend.bioassay.${s.id}` as keyof typeof enAmend], s.id).toBe(s.text);
      expect(guideSentenceText(s)).toBe(s.text);
      expect(guideSentenceText(s, 'en')).toBe(s.text);
    }
  });

  it('Spanish replaces every line and keeps every number', () => {
    for (const s of shown) {
      const es = guideSentenceText(s, 'es');
      expect(es, s.id).not.toBe(s.text);
      expect(es).not.toMatch(RAW_KEY);
      expect(es.match(/\d+/g) ?? []).toEqual(s.text.match(/\d+/g) ?? []);
    }
  });

  it('the damage citation inside the carryover line stays English', () => {
    expect(guideSentenceText(BIOASSAY_DAMAGE, 'es')).toBe(BIOASSAY_DAMAGE.text);
  });
});

describe('localizeDocCopy', () => {
  const en = createT('en');
  const es = createT('es');

  it('passes English through unchanged', () => {
    for (const m of [
      'Remove this photo from its journal entry or animal.',
      'This file was deleted, so it cannot be attached.',
      "This file type can't be stored. Use a JPEG, PNG or WebP file."
    ]) {
      expect(localizeDocCopy(en, m)).toBe(m);
    }
  });

  it('translates the server refusals, including any list of file types', () => {
    expect(localizeDocCopy(es, 'Remove this photo from its journal entry or animal.')).toMatch(
      /foto/
    );
    expect(
      localizeDocCopy(es, 'Only the owner, signed in on their own account, can delete a file.')
    ).toMatch(/dueño/);
    expect(
      localizeDocCopy(es, "This file type can't be stored. Use a JPEG, PNG or WebP file.")
    ).toBe('Este tipo de archivo no se puede guardar. Usa un archivo JPEG, PNG o WebP.');
    expect(localizeDocCopy(es, 'Some unknown server text')).toBe('Some unknown server text');
  });
});

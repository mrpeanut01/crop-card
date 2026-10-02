/**
 * The pea or bean pot test guide (M-50). A linked guide, never a verdict.
 * Every sentence names the entry in `apps/web/scripts/bioassay-sources.json`
 * it rests on, and `bioassayGuide.gate.test.ts` checks each number and key
 * phrase against that entry's quote. The sources disagree on the mix ratio
 * and the day count, so those are shown per source and never merged.
 */

import { t, type MessageKey } from '$lib/i18n';
import { enAmend } from '$lib/i18n/catalogs/en/amend';

export interface GuideSentence {
  id: string;
  text: string;
  sourceKey: string;
  /** Phrases the quote must contain, lowercased. */
  quoteHas: string[];
  /** Each number in `text`, paired with how the quote says it. */
  numbers?: Array<[string, string]>;
}

export const BIOASSAY_STEPS: readonly GuideSentence[] = [
  {
    id: 'controls',
    text: 'Fill a few pots with plain potting mix as controls.',
    sourceKey: 'osu-em9307.controls',
    quoteHas: ['control pots', 'potting mix']
  },
  {
    id: 'mix',
    text: 'Fill a few more pots with the material mixed with potting mix.',
    sourceKey: 'osu-em9307.mixRatio',
    quoteHas: ['test material', 'potting mix']
  },
  {
    id: 'plant',
    text: 'Plant pea seeds in every pot. Some sources use beans too.',
    sourceKey: 'osu-em9307.crop',
    quoteHas: ['pea seeds']
  },
  {
    id: 'grow',
    text: 'Grow them until about three sets of leaves appear.',
    sourceKey: 'osu-em9307.duration',
    quoteHas: ['three sets of leaves']
  },
  {
    id: 'look',
    text: 'Look for distorted or cupped leaves in the new growth, and compare them with the control pots.',
    sourceKey: 'osu-em9307.injury',
    quoteHas: ['distorted or cupped leaves', 'new growth']
  }
];

export const BIOASSAY_RATIOS: readonly GuideSentence[] = [
  {
    id: 'ratio-osu',
    text: 'Oregon State: 2 parts material to 1 part potting mix.',
    sourceKey: 'osu-em9307.mixRatio',
    quoteHas: ['potting mix'],
    numbers: [
      ['2', 'two parts'],
      ['1', 'one part']
    ]
  },
  {
    id: 'ratio-ncsu',
    text: 'NC State: 1 part material to 1 part potting mix.',
    sourceKey: 'ncstate-caldwell-2020.method',
    quoteHas: ['potting mix'],
    numbers: [['1', '1:1']]
  }
];

export const BIOASSAY_TIMING: readonly GuideSentence[] = [
  {
    id: 'days-osu',
    text: 'Oregon State: 14 to 21 days after the seeds come up.',
    sourceKey: 'osu-em9307.duration',
    quoteHas: ['after seeds germinate'],
    numbers: [
      ['14', '14'],
      ['21', '21']
    ]
  }
];

export const BIOASSAY_NOTES: readonly GuideSentence[] = [
  {
    id: 'lab',
    text: 'Oregon State notes that a chemical lab test might not show this kind of weed killer.',
    sourceKey: 'osu-em9307.limits',
    quoteHas: ['chemical lab testing might not indicate']
  },
  {
    id: 'retest',
    text: 'Oregon State suggests testing once or twice a year until there are no signs of damage.',
    sourceKey: 'osu-em9307.retest',
    quoteHas: ['one to two times per year', 'no signs of damage']
  }
];

/** The damage line's citation (M-48). */
export const BIOASSAY_DAMAGE: GuideSentence = {
  id: 'damage',
  text: 'Oregon State Extension says the material is likely contaminated.',
  sourceKey: 'osu-em9307.interpretation',
  quoteHas: ['likely contaminated']
};

export const BIOASSAY_DAMAGE_TEXT = BIOASSAY_DAMAGE.text;

export const BIOASSAY_SOURCE_LINKS: ReadonlyArray<{ label: string; href: string }> = [
  {
    label: 'Oregon State University Extension, EM 9307',
    href: 'https://extension.oregonstate.edu/sites/default/files/documents/em9307.pdf'
  }
];

export const ALL_GUIDE_SENTENCES: readonly GuideSentence[] = [
  ...BIOASSAY_STEPS,
  ...BIOASSAY_RATIOS,
  ...BIOASSAY_TIMING,
  ...BIOASSAY_NOTES,
  BIOASSAY_DAMAGE
];

/** A guide sentence in `locale` (the shipped English with none). The
 *  catalog English must match `text`; `bioassayGuide.test.ts` checks it. */
export function guideSentenceText(s: GuideSentence, locale?: string | null): string {
  if (!locale) return s.text;
  const key = `amend.bioassay.${s.id}`;
  return key in enAmend ? t(locale, key as MessageKey) : s.text;
}

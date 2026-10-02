/**
 * What extension sources advise about prussic acid and nitrate in forage
 * (Phase 33C, M-57). Each line is the strictest statement from a PDF
 * source, quoted with its publisher, never merged and never a threshold.
 * `advice.sources.gate.test.ts` checks every number against the quote in
 * apps/web/scripts/forage-toxicity-sources.json and refuses page-reader
 * sources.
 */

export type ForageAdviceId = 'frostWait' | 'minHeight' | 'nitrogen' | 'drought' | 'hayNitrate';

export interface ForageAdvice {
  id: ForageAdviceId;
  text: string;
  /** Entry key in forage-toxicity-sources.json. */
  entryKey: string;
  /** Index into that entry's `sources`. */
  sourceIndex: number;
  publisher: string;
  url: string;
}

export const FORAGE_ADVICE: Readonly<Record<ForageAdviceId, ForageAdvice>> = {
  frostWait: {
    id: 'frostWait',
    text: 'Virginia Tech: do not graze frosted plants for 7 to 14 days, or until the leaves are dead and dried out.',
    entryKey: 'prussicAcid.frostWait.killingFrostDays',
    sourceIndex: 7,
    publisher: 'Virginia Tech Extension',
    url: 'https://carroll.ext.vt.edu/content/dam/carroll_ext_vt_edu/teutsch_nitrates_prussic_acid_forages_09aug2010.pdf'
  },
  minHeight: {
    id: 'minHeight',
    text: 'Virginia Tech: do not graze until plants reach 20 to 30 inches.',
    entryKey: 'prussicAcid.minHeight.sorghumFamily',
    sourceIndex: 2,
    publisher: 'Virginia Tech Extension',
    url: 'https://carroll.ext.vt.edu/content/dam/carroll_ext_vt_edu/teutsch_nitrates_prussic_acid_forages_09aug2010.pdf'
  },
  nitrogen: {
    id: 'nitrogen',
    text: 'Kansas State: limit nitrogen to 50 pounds per acre per cutting, counting soil nitrate.',
    entryKey: 'nitrate.fertilizer.nPerCutting',
    sourceIndex: 1,
    publisher: 'Kansas State University Research and Extension',
    url: 'https://bookstore.ksre.ksu.edu/pubs/MF3607.pdf'
  },
  drought: {
    id: 'drought',
    text: 'Virginia Tech: wait 7 days after a drought-ending rain.',
    entryKey: 'nitrate.drought.afterRain',
    sourceIndex: 0,
    publisher: 'Virginia Tech Extension',
    url: 'https://carroll.ext.vt.edu/content/dam/carroll_ext_vt_edu/teutsch_nitrates_prussic_acid_forages_09aug2010.pdf'
  },
  hayNitrate: {
    id: 'hayNitrate',
    text: 'Virginia Tech: nitrates do not decrease over time in dry hay.',
    entryKey: 'nitrate.hay.stability',
    sourceIndex: 0,
    publisher: 'Virginia Tech Extension',
    url: 'https://carroll.ext.vt.edu/content/dam/carroll_ext_vt_edu/teutsch_nitrates_prussic_acid_forages_09aug2010.pdf'
  }
};

/** Frost is "on file" when it was seen inside this many days. 14 is the
 *  longest wait in a PDF source (Virginia Tech, 7 to 14 days), so the line
 *  never ends before the strictest source would (M-55). */
export const FROST_LOOKBACK_DAYS = 14;

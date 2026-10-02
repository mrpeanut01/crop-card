/**
 * Small line icons per crop family for the bed diagram and the printed Area
 * Card (#481). Outline only, so they print in black and white. Each `d` is a
 * path in a 10 by 10 box; callers scale it to the footprint.
 */

import { t } from '$lib/i18n';

export type GlyphKey =
  | 'brassica'
  | 'allium'
  | 'cucurbit'
  | 'legume'
  | 'nightshade'
  | 'leafy'
  | 'root'
  | 'grain'
  | 'herb'
  | 'fruit'
  | 'flower';

export interface FamilyGlyph {
  key: GlyphKey;
  /** Plain words for the legend and screen readers. */
  label: string;
  d: string;
}

const circle = (cx: number, cy: number, r: number) =>
  `M${cx - r} ${cy}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0Z`;

const GLYPHS: Record<GlyphKey, FamilyGlyph> = {
  brassica: {
    key: 'brassica',
    label: 'Cabbage family',
    d: `${circle(5, 5.5, 4)}M3 3.8Q5 6.2 7 3.8M3 7.4Q5 5 7 7.4`
  },
  allium: {
    key: 'allium',
    label: 'Onion family',
    d: 'M5 1V4M3.5 1.5L5 4L6.5 1.5M5 4C2 5 2 9 5 9.5C8 9 8 5 5 4Z'
  },
  cucurbit: {
    key: 'cucurbit',
    label: 'Squash family',
    d: `${circle(5, 6, 3.6)}M5 2.4V1M5 1.5Q7 0.5 7.5 2`
  },
  legume: {
    key: 'legume',
    label: 'Bean and pea family',
    d: `M1 7Q5 1 9 3Q5 8.5 1 7Z${circle(3.6, 5.8, 0.6)}${circle(5.3, 4.8, 0.6)}${circle(7, 4, 0.6)}`
  },
  nightshade: {
    key: 'nightshade',
    label: 'Tomato and pepper family',
    d: `${circle(5, 6, 3.5)}M3 2.8L5 3.6L7 2.8M5 3.6V1.2`
  },
  leafy: {
    key: 'leafy',
    label: 'Leafy greens',
    d: 'M5 9.5C1 7 1 3 5 0.8C9 3 9 7 5 9.5ZM5 9.5V2.5'
  },
  root: {
    key: 'root',
    label: 'Roots',
    d: 'M3 3L7 3L5 9.8ZM4 3L3 0.8M5 3V0.5M6 3L7 0.8'
  },
  grain: {
    key: 'grain',
    label: 'Grains and grasses',
    d: 'M5 9.8V1M5 3L3.5 1.8M5 3L6.5 1.8M5 5L3.5 3.8M5 5L6.5 3.8M5 7L3.5 5.8M5 7L6.5 5.8'
  },
  herb: {
    key: 'herb',
    label: 'Herbs',
    d: 'M5 9.8V2M5 7Q2 6 2 4Q4 4 5 6M5 5Q8 4 8 2Q6 2 5 4'
  },
  fruit: {
    key: 'fruit',
    label: 'Fruit',
    d: `${circle(3.5, 6.5, 2)}${circle(6.5, 6.5, 2)}${circle(5, 3.8, 2)}`
  },
  flower: {
    key: 'flower',
    label: 'Flowers and other crops',
    d: `${circle(5, 5, 1.3)}${circle(5, 2.3, 1.4)}${circle(7.7, 5, 1.4)}${circle(5, 7.7, 1.4)}${circle(2.3, 5, 1.4)}`
  }
};

const BY_FAMILY: Record<string, GlyphKey> = {
  brassica: 'brassica',
  allium: 'allium',
  cucurbit: 'cucurbit',
  legume: 'legume',
  'cover-legume': 'legume',
  solanaceae: 'nightshade',
  'leafy-green': 'leafy',
  root: 'root',
  apiaceae: 'root',
  corn: 'grain',
  'cereal-grain': 'grain',
  'cover-grass': 'grain',
  forage: 'grain',
  'herb-culinary': 'herb',
  'small-fruit': 'fruit',
  bramble: 'fruit',
  'vine-fruit': 'fruit',
  'stone-fruit': 'fruit',
  orchard: 'fruit'
};

export function familyGlyph(family: string | null | undefined): FamilyGlyph {
  return GLYPHS[BY_FAMILY[family ?? ''] ?? 'flower'];
}

export const ALL_GLYPHS: readonly FamilyGlyph[] = Object.values(GLYPHS);

/** The glyph's `label` in the viewer's language. */
export function glyphLabel(key: GlyphKey, locale?: string | null): string {
  return t(locale, `garden.glyph.${key}`);
}

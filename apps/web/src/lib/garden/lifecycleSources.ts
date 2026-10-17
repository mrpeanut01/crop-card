import type { CropLifecycle } from '$lib/plugins/schemas';

/** A herb's lifecycle and winter zone as quoted in
 *  `apps/web/scripts/crop-data-sources.json` under `lifecycle` and
 *  `winterHardyToZone` (Phase 37B, R-17). `lifecycleSources.test.ts` keeps
 *  this map equal to the shipped plugins and the sources file, so a value
 *  counts as sourced only when the plugin still carries the quoted one. */
export interface SourcedLifecycle {
  lifecycle: CropLifecycle;
  winterHardyToZone?: string;
}

export const SOURCED_LIFECYCLES: Readonly<Record<string, SourcedLifecycle>> = Object.freeze({
  'basil-genovese': { lifecycle: 'annual' },
  'chives-common': { lifecycle: 'perennial', winterHardyToZone: '4a' },
  'mint-spearmint': { lifecycle: 'perennial', winterHardyToZone: '4a' },
  'oregano-greek': { lifecycle: 'perennial', winterHardyToZone: '5' },
  'rosemary-tuscan-blue': { lifecycle: 'perennial', winterHardyToZone: '8a' },
  'sage-broadleaf': { lifecycle: 'perennial', winterHardyToZone: '4a' },
  'thyme-german-winter': { lifecycle: 'perennial', winterHardyToZone: '5a' },
  'anise-hyssop': { lifecycle: 'perennial', winterHardyToZone: '4a' },
  'bergamot-monarda': { lifecycle: 'perennial', winterHardyToZone: '4a' },
  'catnip-common': { lifecycle: 'perennial', winterHardyToZone: '3a' },
  'hyssop-officinalis': { lifecycle: 'perennial', winterHardyToZone: '4a' },
  'lavender-english-munstead': { lifecycle: 'perennial', winterHardyToZone: '5a' },
  'lemon-balm': { lifecycle: 'perennial', winterHardyToZone: '3a' },
  'lemon-verbena': { lifecycle: 'perennial', winterHardyToZone: '8a' },
  'marjoram-sweet': { lifecycle: 'annual' },
  'mountain-mint': { lifecycle: 'perennial', winterHardyToZone: '4a' },
  'perilla-shiso-green': { lifecycle: 'annual' },
  'stevia-sweetleaf': { lifecycle: 'perennial', winterHardyToZone: '10a' },
  'summer-savory': { lifecycle: 'annual' },
  'tarragon-french': { lifecycle: 'perennial', winterHardyToZone: '3a' },
  'tulsi-holy-basil-rama': { lifecycle: 'annual' },
  'parsley-italian-flat-leaf': { lifecycle: 'biennial' },
  'cilantro-santo': { lifecycle: 'annual' },
  'dill-mammoth': { lifecycle: 'annual' },
  chervil: { lifecycle: 'annual' },
  'fennel-bulb-perfection': { lifecycle: 'annual' },
  'fennel-florence-zefa-fino': { lifecycle: 'annual' },
  lovage: { lifecycle: 'perennial', winterHardyToZone: '4a' },
  'chamomile-german': { lifecycle: 'annual' },
  'calendula-resina': { lifecycle: 'annual' },
  'nasturtium-companion': { lifecycle: 'annual' }
});

/** The names a lifecycle or zone quote may use for each herb: common names
 *  and the botanical name. Matched case-insensitively on word boundaries. */
export const LIFECYCLE_QUOTE_NAMES: Readonly<Record<string, readonly string[]>> = Object.freeze({
  'basil-genovese': ['basil', 'Ocimum basilicum'],
  'chives-common': ['chives', 'chive', 'Allium schoenoprasum'],
  'mint-spearmint': ['spearmint', 'mint', 'mints', 'Mentha spicata'],
  'oregano-greek': ['oregano', 'Greek oregano', 'Origanum vulgare'],
  'rosemary-tuscan-blue': ['rosemary', 'Salvia rosmarinus', 'Rosmarinus officinalis'],
  'sage-broadleaf': ['sage', 'garden sage', 'Salvia officinalis'],
  'thyme-german-winter': ['thyme', 'Thymus vulgaris'],
  'anise-hyssop': ['anise hyssop', 'Agastache foeniculum'],
  'bergamot-monarda': ['bee balm', 'bergamot', 'Monarda', 'Monarda didyma'],
  'catnip-common': ['catnip', 'Nepeta cataria'],
  'hyssop-officinalis': ['hyssop', 'Hyssopus officinalis'],
  'lavender-english-munstead': ['lavender', 'English lavender', 'Lavandula angustifolia'],
  'lemon-balm': ['lemon balm', 'Melissa officinalis'],
  'lemon-verbena': ['lemon verbena', 'Aloysia citrodora', 'Aloysia triphylla'],
  'lemongrass-east-indian': ['lemongrass', 'lemon grass', 'Cymbopogon', 'Cymbopogon flexuosus'],
  'marjoram-sweet': ['marjoram', 'sweet marjoram', 'Origanum majorana'],
  'mountain-mint': ['mountain mint', 'Pycnanthemum', 'Pycnanthemum muticum'],
  'perilla-shiso-green': ['perilla', 'shiso', 'Perilla frutescens'],
  'stevia-sweetleaf': ['stevia', 'Stevia rebaudiana'],
  'summer-savory': ['summer savory', 'Satureja hortensis'],
  'tarragon-french': ['tarragon', 'French tarragon', 'Artemisia dracunculus'],
  'tulsi-holy-basil-rama': ['holy basil', 'tulsi', 'Ocimum tenuiflorum', 'Ocimum sanctum'],
  'parsley-italian-flat-leaf': ['parsley', 'Petroselinum crispum'],
  'cilantro-santo': ['cilantro', 'coriander', 'Coriandrum sativum'],
  'dill-mammoth': ['dill', 'Anethum graveolens'],
  chervil: ['chervil', 'Anthriscus cerefolium'],
  'fennel-bulb-perfection': ['fennel', 'Florence fennel', 'Foeniculum vulgare'],
  'fennel-florence-zefa-fino': ['fennel', 'Florence fennel', 'Foeniculum vulgare'],
  lovage: ['lovage', 'Levisticum officinale'],
  'chamomile-german': [
    'chamomile',
    'German chamomile',
    'Matricaria recutita',
    'Matricaria chamomilla'
  ],
  'calendula-resina': ['calendula', 'pot marigold', 'Calendula officinalis'],
  'nasturtium-companion': ['nasturtium', 'nasturtiums', 'Tropaeolum majus']
});

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** True when `quote` names the herb by one of its listed names. */
export function quoteNamesHerb(pluginId: string, quote: string): boolean {
  return (LIFECYCLE_QUOTE_NAMES[pluginId] ?? []).some((name) =>
    new RegExp(`(^|[^A-Za-z])${escapeRegExp(name).replace(/ /g, '\\s+')}([^A-Za-z]|$)`, 'i').test(
      quote
    )
  );
}

const LIFECYCLE_WORD: Record<CropLifecycle, RegExp> = {
  annual: /\bannuals?\b/i,
  biennial: /\bbiennials?\b/i,
  perennial: /\bperennials?\b/i
};

/** True when `quote` states the lifecycle word (or its plural, as a table
 *  heading prints it). */
export function quoteStatesLifecycle(lifecycle: CropLifecycle, quote: string): boolean {
  return LIFECYCLE_WORD[lifecycle].test(quote);
}

/** True when `quote` says "zone" and states the stored zone: the number
 *  alone for a whole zone ("zones 7 to 10"), the number and letter for a
 *  half zone ("zone 7b"). */
export function quoteStatesZone(zone: string, quote: string): boolean {
  if (!/\bzones?\b/i.test(quote)) return false;
  const m = /^(\d{1,2})([ab])?$/.exec(zone);
  if (!m) return false;
  const tail = m[2] ? `\\s?${m[2]}(?![A-Za-z])` : '(?![\\dA-Za-z])';
  return new RegExp(`(^|[^\\d])${m[1]}${tail}`, 'i').test(quote);
}

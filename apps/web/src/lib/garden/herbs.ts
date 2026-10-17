/** The herbs Phase 37 treats as an herb garden (R-3), from four crop
 *  families: `herb-culinary` without strawflower, every `culinary-herb`
 *  plugin, the `apiaceae` herbs and chamomile, calendula and nasturtium.
 *  No family is renamed. `herbs.test.ts` keeps the list resolving. */
export const HERB_PLUGIN_IDS: readonly string[] = Object.freeze([
  // herb-culinary
  'basil-genovese',
  'chives-common',
  'mint-spearmint',
  'oregano-greek',
  'rosemary-tuscan-blue',
  'sage-broadleaf',
  'thyme-german-winter',
  // culinary-herb
  'anise-hyssop',
  'bergamot-monarda',
  'catnip-common',
  'hyssop-officinalis',
  'lavender-english-munstead',
  'lemon-balm',
  'lemon-verbena',
  'lemongrass-east-indian',
  'marjoram-sweet',
  'mountain-mint',
  'perilla-shiso-green',
  'stevia-sweetleaf',
  'summer-savory',
  'tarragon-french',
  'tulsi-holy-basil-rama',
  // apiaceae herbs
  'parsley-italian-flat-leaf',
  'cilantro-santo',
  'dill-mammoth',
  'chervil',
  'fennel-bulb-perfection',
  'fennel-florence-zefa-fino',
  'lovage',
  // edible flowers and tea plants
  'chamomile-german',
  'calendula-resina',
  'nasturtium-companion'
]);

const HERB_SET: ReadonlySet<string> = new Set(HERB_PLUGIN_IDS);

export function isHerbGardenCrop(pluginId: string | null | undefined): boolean {
  return !!pluginId && HERB_SET.has(pluginId);
}

/** Crop seasonal task rows (OP-21, docs/design/ORCHARD_CALENDAR.md): the
 *  shipped English of every `seasonalTasks` / `orchardSeasonalTasks` row,
 *  keyed `seasonal.<pluginId>.<rowKey>.<title|body>`. Shown through
 *  `lib/i18n/seasonalTaskText.ts` only while the stored text still equals
 *  this English; `seasonalTaskText.test.ts` keeps it equal to the plugins. */
export const enSeasonal = {
  'seasonal.apple-orchard.post-bloom-thinning.title': 'Hand fruit thinning',
  'seasonal.apple-orchard.post-bloom-thinning.body':
    'Thin to one fruit per cluster for size + return-bloom.',
  'seasonal.apple-orchard.harvest.title': 'Apple harvest window',
  'seasonal.apple-orchard.harvest.body': "Pick by the harvest cues in this crop's Care Guide.",
  'seasonal.blackberry-triple-crown.post-harvest-prune.title': 'Remove fruited floricanes',
  'seasonal.blackberry-triple-crown.post-harvest-prune.body':
    'Prune out fruited canes to ground after harvest; train current-year primocanes to wires.',
  'seasonal.blackberry-triple-crown.tip-primocanes.title': 'Tip primocanes at about 5 ft',
  'seasonal.blackberry-triple-crown.tip-primocanes.body':
    "Encourages lateral branching for next year's crop.",
  'seasonal.blackberry-triple-crown.harvest.title': 'Blackberry harvest',
  'seasonal.blackberry-triple-crown.harvest.body':
    'Pick fully black + dull (not glossy). Glossy = not ripe.',
  'seasonal.blueberry-bluecrop.winter-prune.title': 'Winter pruning (dormant)',
  'seasonal.blueberry-bluecrop.winter-prune.body':
    'Prune out one of every six existing canes, oldest first, close to the ground; thin twiggy growth. A mature bush should have 10 to 15 canes.',
  'seasonal.blueberry-bluecrop.swd-monitoring.title': 'Spotted-wing drosophila trap monitoring',
  'seasonal.blueberry-bluecrop.swd-monitoring.body': 'Apple cider vinegar + yeast traps.',
  'seasonal.blueberry-bluecrop.harvest.title': 'Harvest window',
  'seasonal.blueberry-bluecrop.harvest.body':
    'Pick every five to seven days, more often if birds are a problem; berries fully blue + drop into hand without pull.',
  'seasonal.garlic-music-hardneck.garlic-plant.title': 'Plant garlic cloves',
  'seasonal.garlic-music-hardneck.garlic-plant.body':
    'Mid-Oct → mid-Nov. Mulch with a thick layer of straw after planting.',
  'seasonal.garlic-music-hardneck.garlic-scape-cut.title': 'Cut scapes (hardneck only)',
  'seasonal.garlic-music-hardneck.garlic-scape-cut.body':
    'Remove flower scapes when they curl once — channels energy into bulbing.',
  'seasonal.grape-concord.winter-prune.title': 'Winter pruning (dormant)',
  'seasonal.grape-concord.winter-prune.body':
    "Cane prune to four-arm Kniffin or umbrella Kniffin. Remove most of last year's wood.",
  'seasonal.grape-concord.early-shoot-thin.title': 'Shoot thinning at 5 to 7 in',
  'seasonal.grape-concord.early-shoot-thin.body':
    'Remove non-count shoots and weak shoots from cordon to balance crop.',
  'seasonal.grape-concord.leaf-pull.title': 'Pull basal leaves around clusters',
  'seasonal.grape-concord.leaf-pull.body': 'Reduces botrytis.',
  'seasonal.grape-concord.harvest.title': 'Concord harvest',
  'seasonal.grape-concord.harvest.body':
    'At least 16° Brix (the juice processor minimum) + characteristic foxy aroma. Single-pass mechanical or hand.',
  'seasonal.peach-redhaven.harvest.title': 'Peach harvest window',
  'seasonal.peach-redhaven.harvest.body': 'Ground-color yellow-orange + slight give = pick.',
  'seasonal.pear-bartlett.harvest.title': 'Harvest pears (pre-tree-ripe)',
  'seasonal.pear-bartlett.harvest.body':
    'Pick when starch test shows ripening but before tree-ripe; finish on bench.',
  'seasonal.raspberry-heritage.mow-canes-down.title': 'Mow primocane raspberry to ground (winter)',
  'seasonal.raspberry-heritage.mow-canes-down.body':
    'Single-crop management: cut all canes to the ground after dormancy; new canes will fruit Aug-Oct.',
  'seasonal.raspberry-heritage.swd-monitoring.title': 'SWD trap monitoring',
  'seasonal.raspberry-heritage.swd-monitoring.body':
    'Spotted-wing drosophila is the dominant ripe-fruit pest.',
  'seasonal.raspberry-heritage.harvest.title': 'Fall raspberry harvest',
  'seasonal.raspberry-heritage.harvest.body':
    'Pick ripe berries often. Cool the fruit as soon as possible after harvest.',
  'seasonal.strawberry-jewel.row-renovation.title': 'Renovate matted rows post-harvest',
  'seasonal.strawberry-jewel.row-renovation.body':
    'Within 1 week of the last harvest, mow off the leaves; then narrow the rows, fertilize and irrigate.',
  'seasonal.strawberry-jewel.winter-mulch.title': 'Apply straw winter mulch',
  'seasonal.strawberry-jewel.winter-mulch.body':
    'Spread straw over the plants after the first freezing weather in fall, before sustained cold.',
  'seasonal.strawberry-jewel.remove-mulch.title': 'Pull mulch off rows for spring growth',
  'seasonal.strawberry-jewel.remove-mulch.body':
    'Mulch goes between rows for weed suppression + frost-cloth base.',
  'seasonal.strawberry-jewel.frost-watch.title': 'Bloom frost watch',
  'seasonal.strawberry-jewel.frost-watch.body':
    'Open blossoms are damaged at 30 °F. Cover rows on frost nights. Overhead irrigation protects only while water runs continuously until temperatures rise above freezing; stopping too early can do more damage than not irrigating.'
} as const;

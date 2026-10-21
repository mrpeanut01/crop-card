/** Crop seasonal task rows (OP-21, docs/design/ORCHARD_CALENDAR.md): the
 *  shipped English of every `seasonalTasks` row (plus `RETIRED_SEASONAL_KEYS`),
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
    'Open blossoms are damaged at 30 °F. Cover rows on frost nights. Overhead irrigation protects only while water runs continuously until temperatures rise above freezing; stopping too early can do more damage than not irrigating.',
  'seasonal.basil-genovese.pinch-flower-buds.title': 'Pinch off basil flower buds',
  'seasonal.basil-genovese.pinch-flower-buds.body':
    'Pinch stem tips for a bushier plant, and pinch off flower buds as soon as you see them. Left on, buds change the flavor of the leaves.',
  'seasonal.mint-spearmint.remove-flower-spikes.title': 'Remove mint flower spikes',
  'seasonal.mint-spearmint.remove-flower-spikes.body':
    "Remove flower spikes as they appear to keep the leaves' flavor.",
  'seasonal.mint-spearmint.divide.title': 'Divide mint if it is crowded',
  'seasonal.mint-spearmint.divide.body':
    'Divide the plants every 3 to 4 years to keep them vigorous.',
  'seasonal.chives-common.divide.title': 'Divide chive clumps',
  'seasonal.chives-common.divide.body':
    'In early spring, divide the clumps every 2 to 3 years to keep plants vigorous and uncrowded.',
  'seasonal.chives-common.remove-flowers.title': 'Remove chive flowers before they fade',
  'seasonal.chives-common.remove-flowers.body':
    'Cut off the flowers before they fade, or chives self-sow and spread through the garden.',
  'seasonal.cilantro-santo.sow-again.title': 'Sow cilantro again',
  'seasonal.cilantro-santo.sow-again.body':
    'Sow again every 3 to 4 weeks for a steady supply of fresh leaves. Cilantro goes to seed quickly.',
  'seasonal.dill-mammoth.sow-again.title': 'Sow dill again',
  'seasonal.dill-mammoth.sow-again.body':
    'Sow again every two weeks for fresh leaves, since plants decline soon after they flower.',
  'seasonal.chervil.sow-again.title': 'Sow chervil again',
  'seasonal.chervil.sow-again.body':
    'Sow again every 3 to 4 weeks for fresh leaves, since chervil flowers quickly.',
  'seasonal.oregano-greek.winter-mulch.title': 'Mulch oregano for winter',
  'seasonal.oregano-greek.winter-mulch.body':
    'In November or December, after the soil has frozen, cover the plants with straw or evergreen boughs. Take it off as growth starts in spring.',
  'seasonal.lavender-english-munstead.spring-prune.title': 'Prune lavender in spring',
  'seasonal.lavender-english-munstead.spring-prune.body':
    'Wait until new growth starts in spring before pruning. Do not cut the plants back in the fall.',
  'seasonal.thyme-german-winter.renew-cut-back.title': 'Cut back woody thyme',
  'seasonal.thyme-german-winter.renew-cut-back.body':
    'When thyme gets woody, cut it back hard in spring, every few years, for young tender stems.',
  'seasonal.lemon-balm.cut-back.title': 'Cut back lemon balm',
  'seasonal.lemon-balm.cut-back.body':
    'Cut the plants back to about half their height for fresh new growth, then water to help them recover.',
  'seasonal.lemon-balm.thin-midsummer.title': 'Thin lemon balm in mid-summer',
  'seasonal.lemon-balm.thin-midsummer.body':
    'Cut out some stems to let air through, and cut off flower stalks before they set seed.',
  'seasonal.sage-broadleaf.spring-prune.title': 'Prune sage in spring',
  'seasonal.sage-broadleaf.spring-prune.body':
    'Prune the plants back in spring just as new growth starts.',
  'seasonal.parsley-italian-flat-leaf.pot-for-winter.title': 'Pot up parsley for winter',
  'seasonal.parsley-italian-flat-leaf.pot-for-winter.body':
    'In fall, dig a few plants and pot them to grow indoors over the winter in a bright, cool spot.',
  'seasonal.catnip-common.spring-cut-back.title': 'Cut back catnip in spring',
  'seasonal.catnip-common.spring-cut-back.body':
    'Cut the plants back in spring just as growth starts, and divide old plants that look untidy.',
  'seasonal.tarragon-french.spring-cut-back.title': 'Cut back tarragon in spring',
  'seasonal.tarragon-french.spring-cut-back.body':
    'Leave the tops standing over winter, then cut the plants back in spring just as growth starts.',
  'seasonal.tarragon-french.divide.title': 'Divide tarragon every few years',
  'seasonal.tarragon-french.divide.body':
    'Divide the plants every 3 to 4 years to keep the planting vigorous and productive.',
  'seasonal.marjoram-sweet.prune-back.title': 'Prune back sweet marjoram',
  'seasonal.marjoram-sweet.prune-back.body':
    'When the plants are 6 to 8 inches tall, prune them back for bushier growth.',
  'seasonal.nasturtium-companion.summer-cut-back.title': 'Cut back leggy nasturtiums',
  'seasonal.nasturtium-companion.summer-cut-back.body':
    'If the plants decline or get leggy in summer, cut them back lightly for new growth the rest of the season.',
  'seasonal.anise-hyssop.spring-prune.title': 'Prune anise hyssop in early spring',
  'seasonal.anise-hyssop.spring-prune.body':
    'Prune the plants in early spring to encourage blooming.',
  'seasonal.bergamot-monarda.divide.title': 'Divide bee balm every 2 to 3 years',
  'seasonal.bergamot-monarda.divide.body':
    'In early spring, as the shoots come up, dig and divide the clumps to control their spread and renew the plants.',
  'seasonal.bergamot-monarda.fall-cleanup.title': 'Remove bee balm debris in fall',
  'seasonal.bergamot-monarda.fall-cleanup.body':
    'Clear away and destroy diseased leaves and stems in fall, since powdery mildew survives the winter on them.',
  'seasonal.hyssop-officinalis.spring-trim.title': 'Trim hyssop in spring',
  'seasonal.hyssop-officinalis.spring-trim.body':
    'Trim the plants in spring to keep them bushy and well shaped.',
  'seasonal.mountain-mint.root-prune.title': 'Prune mountain mint roots in spring',
  'seasonal.mountain-mint.root-prune.body':
    "If you don't want the planting to spread, prune the roots with a spade in spring.",
  'seasonal.perilla-shiso-green.pinch-flowers.title': 'Pinch off perilla flowers',
  'seasonal.perilla-shiso-green.pinch-flowers.body':
    'Pinch off the flowers before they go to seed. Left alone, perilla self-seeds heavily and spreads.',
  'seasonal.stevia-sweetleaf.pinch-tips.title': 'Pinch stevia tips for a bushier plant',
  'seasonal.stevia-sweetleaf.pinch-tips.body':
    'Pinch the stem tips every 2 to 3 weeks so the plant branches out and grows bushier.',
  'seasonal.stevia-sweetleaf.pinch-flower-buds.title': 'Pinch off stevia flower buds',
  'seasonal.stevia-sweetleaf.pinch-flower-buds.body':
    'Pinch off flower buds as soon as they appear. The leaves are sweetest before the plant flowers.',
  'seasonal.tulsi-holy-basil-rama.prune-to-size.title': 'Prune tulsi to fit its space',
  'seasonal.tulsi-holy-basil-rama.prune-to-size.body':
    'Tulsi grows fast, and one plant can cover 10 square feet. Prune it back to fit the space you have.',
  'seasonal.lovage.prune-for-leaves.title': 'Prune lovage for fresh leaves',
  'seasonal.lovage.prune-for-leaves.body':
    'From late spring to early fall, cut the plants back to keep a supply of fresh, new leaves coming.',
  'seasonal.lovage.remove-old-foliage.title': 'Remove old lovage foliage in late fall',
  'seasonal.lovage.remove-old-foliage.body': 'In late fall, cut away the old foliage.',
  'seasonal.fennel-bulb-perfection.plant-again.title': 'Plant more fennel',
  'seasonal.fennel-bulb-perfection.plant-again.body':
    'For a steady supply of bulbs, plant a short row again every 3 to 4 weeks.',
  'seasonal.fennel-bulb-perfection.mound-soil.title': 'Mound soil around fennel bulbs',
  'seasonal.fennel-bulb-perfection.mound-soil.body':
    'When the bulbs start to swell, mound soil around them so they stay pale and mild.',
  'seasonal.fennel-florence-zefa-fino.plant-again.title': 'Plant more fennel',
  'seasonal.fennel-florence-zefa-fino.plant-again.body':
    'For a steady supply of bulbs, plant a short row again every 3 to 4 weeks.',
  'seasonal.fennel-florence-zefa-fino.mound-soil.title': 'Mound soil around fennel bulbs',
  'seasonal.fennel-florence-zefa-fino.mound-soil.body':
    'When the bulbs start to swell, mound soil around them so they stay pale and mild.',
  'seasonal.chamomile-german.deadhead.title': 'Deadhead spent chamomile flowers',
  'seasonal.chamomile-german.deadhead.body':
    "Pick off spent flowers so the seeds don't scatter and come up as seedlings next year.",
  'seasonal.calendula-resina.pinch.title': 'Pinch calendula for bushier plants',
  'seasonal.calendula-resina.pinch.body':
    'Once the plants are several inches tall, pinch the growing tips so they branch and grow bushier.',
  'seasonal.calendula-resina.deadhead.title': 'Deadhead calendula',
  'seasonal.calendula-resina.deadhead.body':
    'Remove spent flowers regularly to keep the plants blooming. Flowers left on may self-sow.',
  'seasonal.rosemary-tuscan-blue.prune-after-bloom.title': 'Prune rosemary after it blooms',
  'seasonal.rosemary-tuscan-blue.prune-after-bloom.body':
    'Once the plants finish blooming, you can prune them back to encourage dense, leafy growth.'
} as const;

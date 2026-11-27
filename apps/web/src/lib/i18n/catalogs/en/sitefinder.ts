/** Find a spot (Phase 38D, `/plan/site-finder`): the page, the factor
 *  sentences from `lib/siteFinder/explain.ts` and the banners from
 *  `lib/server/siteFinder/run.ts`. Plain words for a first-time gardener.
 *  Every score and estimate here is described as a rough guide. */
export const enSitefinder = {
  'sitefinder.docTitle': 'Find a spot',
  'sitefinder.kicker': 'Plan · Find a spot',
  'sitefinder.title': 'Find a good spot to plant',
  'sitefinder.lede':
    'Tell CropCard what you want to grow and where to look. It checks the sun, the trees and buildings on your map, your water tap and the USDA soil survey, then suggests places to try.',
  'sitefinder.backToPlan': 'Back to Plan',
  'sitefinder.readonly.body':
    'Find a spot suggests places on the farm for a new garden, bed, orchard or field. It looks at sun, shade, water and the soil survey.',
  'sitefinder.readonly.ask': 'Only the farm owner can use it and add Areas. Ask the owner.',

  'sitefinder.step.goal': 'What do you want to plant?',
  'sitefinder.step.where': 'Where should I look?',
  'sitefinder.step.options': 'Before you search',
  'sitefinder.step.results': 'Places to try',

  'sitefinder.goal.vegetable-garden.title': 'Vegetable garden',
  'sitefinder.goal.vegetable-garden.hint': 'Tomatoes, beans, greens and the like.',
  'sitefinder.goal.vegetable-garden.areaName': 'Vegetable garden',
  'sitefinder.goal.herb-garden.title': 'Herb garden',
  'sitefinder.goal.herb-garden.hint': 'A small bed of kitchen herbs near the door.',
  'sitefinder.goal.herb-garden.areaName': 'Herb garden',
  'sitefinder.goal.flower-garden.title': 'Flower garden',
  'sitefinder.goal.flower-garden.hint': 'A bed for cut flowers or color.',
  'sitefinder.goal.flower-garden.areaName': 'Flower garden',
  'sitefinder.goal.raised-beds.title': 'Raised beds',
  'sitefinder.goal.raised-beds.hint': 'Boxes filled with soil you bring in.',
  'sitefinder.goal.raised-beds.areaName': 'Raised beds',
  'sitefinder.goal.fruit-trees.title': 'Fruit trees',
  'sitefinder.goal.fruit-trees.hint': 'A few trees or a small orchard.',
  'sitefinder.goal.fruit-trees.areaName': 'Orchard',
  'sitefinder.goal.berry-patch.title': 'Berry patch',
  'sitefinder.goal.berry-patch.hint': 'Strawberries, raspberries or blueberries.',
  'sitefinder.goal.berry-patch.areaName': 'Berry patch',
  'sitefinder.goal.row-crop-field.title': 'Field for row crops',
  'sitefinder.goal.row-crop-field.hint': 'Corn, pumpkins, grain or a market plot.',
  'sitefinder.goal.row-crop-field.areaName': 'New field',

  'sitefinder.size.lede':
    'How big should it be? These are starting sizes from CropCard. Change them to fit your plan.',
  'sitefinder.size.width': 'Width, east to west ({unit})',
  'sitefinder.size.length': 'Length, north to south ({unit})',
  'sitefinder.size.invalid': 'Type a width and a length for the plot.',

  'sitefinder.where.needLocation':
    'CropCard needs to know where your farm is before it can look for a spot.',
  'sitefinder.where.lede':
    'Tap the map, or drag the round handle, to move the dashed box over the ground you want searched.',
  'sitefinder.where.smaller': 'Smaller box',
  'sitefinder.where.larger': 'Larger box',
  'sitefinder.where.boxSize': 'The box is {size} on each side.',
  'sitefinder.where.tilesNote':
    'The map picture is only for you to look at. It is never sent anywhere.',
  'sitefinder.map.aria': 'Map of your farm with the search box',
  'sitefinder.map.handle': 'Drag to move the search box',

  'sitefinder.options.overlapLegend': 'Growing space you already have',
  'sitefinder.options.overlap': 'A spot can overlap {name}',
  'sitefinder.options.aerial': 'Also have Claude look at a USDA aerial photo of this box',
  'sitefinder.options.aerialNote':
    'The photo is from the USDA NAIP program and can be a few years old. Claude points out trees, buildings and open ground it can see. You decide what goes on your map.',
  'sitefinder.options.aerialOff': 'The photo reading is not available: {reason}',
  'sitefinder.options.worksWithout':
    'Find a spot still works from the sun, your map and the soil survey.',
  'sitefinder.ai.noKey': 'Claude is not set up for this farm.',
  'sitefinder.run.go': 'Find spots',
  'sitefinder.run.busy': 'Looking...',

  'sitefinder.err.failed': 'Could not search for a spot. Try again.',
  'sitefinder.err.offline': 'No connection. Find a spot needs to be online.',
  'sitefinder.err.createFailed': 'Could not save that. Try again.',
  'sitefinder.err.tooMany': 'Too many searches in a short time. Wait a minute and try again.',

  'sitefinder.results.fromAi':
    'From the sun, your map, the soil survey and what Claude saw in the aerial photo.',
  'sitefinder.results.fromEngine': 'From the sun, your map and the soil survey.',
  'sitefinder.results.roughGuide':
    'The ranking is a rough guide from CropCard. Walk the ground before you dig.',
  'sitefinder.results.tooBig':
    'The plot is bigger than the search box. Make the box larger or the plot smaller.',
  'sitefinder.results.none':
    'No open place for this plot was found in the box. Move the box, make it larger, or let a spot overlap growing space you already have.',
  'sitefinder.results.allDismissed': 'You set every place aside. Move the box and search again.',
  'sitefinder.results.photoSource':
    'Aerial photo: USDA NAIP through USGS The National Map. Public domain.',

  'sitefinder.spot.title': 'Spot {n}',
  'sitefinder.spot.soilTitle': 'What the soil survey says here',
  'sitefinder.spot.soilSource': 'USDA soil survey',
  'sitefinder.spot.created': '{name} is on your map.',
  'sitefinder.spot.openDesigner': 'Open the garden designer',
  'sitefinder.spot.planPlanting': 'Plan a planting',
  'sitefinder.spot.seeOnMap': 'See it on the farm map',
  'sitefinder.spot.nameLabel': 'Name for the new Area',
  'sitefinder.spot.save': 'Save the Area',
  'sitefinder.spot.cancel': 'Cancel',
  'sitefinder.spot.create': 'Create this Area here',
  'sitefinder.spot.notHere': 'Not here',

  'sitefinder.prov.survey': 'Soil survey',
  'sitefinder.prov.map': 'Your map',
  'sitefinder.prov.estimate': 'Rough estimate',
  'sitefinder.label.best': 'Best match',
  'sitefinder.label.good': 'Good',
  'sitefinder.label.look': 'Worth a look',
  'sitefinder.confidence.high': 'Most things were checked.',
  'sitefinder.confidence.medium': 'Some things could not be checked.',
  'sitefinder.confidence.low': 'Much could not be checked.',

  'sitefinder.f.sun.full':
    'Gets sun most of the day in summer: about {hours} hours, by a rough estimate.',
  'sitefinder.f.sun.part':
    'Gets sun for part of the day in summer: about {hours} hours, by a rough estimate.',
  'sitefinder.f.sun.shade':
    'Shaded for much of the day in summer: about {hours} hours of sun, by a rough estimate.',
  'sitefinder.f.shade.morning': '{thing} to the {dir} shades this spot in the morning.',
  'sitefinder.f.shade.afternoon': '{thing} to the {dir} shades this spot in the afternoon.',
  'sitefinder.f.shade.all-day': '{thing} to the {dir} shades this spot for part of the day.',
  'sitefinder.f.shade.guessed': 'Its height is a guess.',
  'sitefinder.thing.tree': 'A tree',
  'sitefinder.thing.tree-line': 'A line of trees',
  'sitefinder.thing.building': 'A building',
  'sitefinder.thing.water': 'Water',
  'sitefinder.thing.pavement': 'Pavement',
  'sitefinder.thing.other': 'Something tall',
  'sitefinder.dir.n': 'north',
  'sitefinder.dir.ne': 'northeast',
  'sitefinder.dir.e': 'east',
  'sitefinder.dir.se': 'southeast',
  'sitefinder.dir.s': 'south',
  'sitefinder.dir.sw': 'southwest',
  'sitefinder.dir.w': 'west',
  'sitefinder.dir.nw': 'northwest',
  'sitefinder.f.soil.unavailable':
    'The soil survey could not be reached, so the soil here was not checked.',
  'sitefinder.f.soil.noData': 'The soil survey has no data for this ground.',
  'sitefinder.f.soil.notSoil':
    'The soil survey has no soil details here, which is common around buildings. Raised beds filled with soil you bring in are one option.',
  'sitefinder.f.drainage.unknown': 'The soil survey does not say how this ground drains.',
  'sitefinder.f.drainage.cls.well': 'The soil survey calls this ground well drained.',
  'sitefinder.f.drainage.cls.moderately-well':
    'The soil survey calls this ground moderately well drained.',
  'sitefinder.f.depth.good': 'The soil survey notes no shallow rock here.',
  'sitefinder.f.slope.flat': 'The soil survey maps this ground as nearly flat.',
  'sitefinder.f.slope.gentle': 'The soil survey maps a gentle slope here.',
  'sitefinder.f.slope.moderate': 'The soil survey maps a moderate slope here.',
  'sitefinder.f.slope.steep': 'The soil survey maps a steep slope here.',
  'sitefinder.f.slope.very-steep': 'The soil survey maps a very steep slope here.',
  'sitefinder.f.water.dist': 'About {dist} from your water ({name}).',
  'sitefinder.f.water.unknown': 'Mark your water tap on the map to include it.',
  'sitefinder.f.house.dist': 'About {dist} from your house.',
  'sitefinder.f.house.unknown': 'Draw your house on the map to include the walk from the door.',
  'sitefinder.f.roots.close':
    'A tree is about {dist} away. Its roots and shade may reach this spot.',
  'sitefinder.f.roots.near': 'A tree is about {dist} away.',
  'sitefinder.f.overlap.inside': 'Inside {name}, which you said a spot can overlap.',
  'sitefinder.f.ai.note': 'Claude saw: {text}',

  'sitefinder.also.lead': 'Claude also liked a spot here:',
  'sitefinder.also.outside-box': 'But the plot would not fit inside the search box there.',
  'sitefinder.also.outside-boundary': 'But it is outside the property line on your map.',
  'sitefinder.also.area': 'But it sits on an Area that is already on your map.',
  'sitefinder.also.obstacle': 'But it sits on a building, water or pavement.',
  'sitefinder.also.lower-score': 'But other places scored higher for sun, soil or water.',

  'sitefinder.seen.title': 'Things Claude saw in the photo',
  'sitefinder.seen.lede':
    'These are suggestions. Nothing is added to your map unless you add it. Check each one against what you know is there.',
  'sitefinder.seen.kind.tree': 'Tree',
  'sitefinder.seen.kind.tree-line': 'Line of trees',
  'sitefinder.seen.kind.building': 'Building',
  'sitefinder.seen.kind.water': 'Water',
  'sitefinder.seen.kind.pavement': 'Pavement or driveway',
  'sitefinder.seen.kind.shadow': 'Shadow',
  'sitefinder.seen.kind.bare-ground': 'Bare ground',
  'sitefinder.seen.kind.wet-area': 'Ground that looks wet',
  'sitefinder.seen.kind.open-lawn': 'Open lawn',
  'sitefinder.seen.kind.other': 'Something else',
  'sitefinder.seen.onMap': 'Already on your map.',
  'sitefinder.seen.added': 'Added to your map.',
  'sitefinder.seen.add': 'Add to my map',
  'sitefinder.seen.height': 'How tall is it? ({unit})',
  'sitefinder.seen.heightHint':
    'Your best guess is fine. The height sets how far its shadow reaches.',
  'sitefinder.seen.heightNeeded': 'Type how tall it is.',
  'sitefinder.seen.save': 'Add it',

  'sitefinder.unchecked.title': 'What I could not check',
  'sitefinder.unchecked.shade':
    'Shade. No trees or buildings are drawn on your map and no photo was read, so the sun estimate assumes open sky.',
  'sitefinder.unchecked.water': 'Water. No water tap is marked on your map.',
  'sitefinder.unchecked.soilUnavailable':
    'Soil. The USDA soil survey could not be reached. Try again later.',
  'sitefinder.unchecked.soilNoData': 'Soil. The USDA soil survey has no soil details here.',
  'sitefinder.unchecked.photoAge':
    'Changes since the aerial photo was taken. It can be a few years old.',
  'sitefinder.unchecked.underground':
    'Buried lines, pipes, a septic tank or a drain field. Call 811 before you dig.',
  'sitefinder.unchecked.rules': 'Local rules. Check your zoning and any homeowner association.',
  'sitefinder.unchecked.walk':
    'The ground itself. Walk it after a rain and at different times of day before you decide.',

  'sitefinder.why.noKey': 'Claude is not set up for this farm, so the aerial photo was not read.',
  'sitefinder.why.overCap': "This month's AI help is used up, so the aerial photo was not read.",
  'sitefinder.why.quota': "Today's aerial photo readings are used up.",
  'sitefinder.why.rateLimit': 'Claude could not read the aerial photo just now.',
  'sitefinder.why.offline': 'The aerial photo could not be read just now.',
  'sitefinder.why.timeout': 'Reading the aerial photo took too long.',
  'sitefinder.why.invalid': "Claude's reading of the photo could not be used.",
  'sitefinder.why.noPhoto': 'No USDA aerial photo could be loaded for this ground.',
  'sitefinder.why.limit': 'The aerial photo was not read: {reason}',
  'sitefinder.why.still': 'These places come from the sun, your map and the soil survey.',

  'sitefinder.entry.title': 'Help me pick a spot',
  'sitefinder.entry.hint': 'Let CropCard look at sun, shade, water and soil.',
  'sitefinder.entry.farmLink': 'Not sure where to put it? Find a good spot',
  'sitefinder.entry.briefLink': 'Not sure where the sun is? Find a spot'
} as const;

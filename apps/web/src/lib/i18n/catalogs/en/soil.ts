/** Soil survey (USDA NRCS SSURGO) text: the panel, the plain-word lines
 *  from `lib/soil/describe.ts` and the siting flags from `lib/soil/siting.ts`.
 *  The texture, drainage, flooding and farmland names are NRCS's own words;
 *  the notes only restate them for a first-time gardener. */
export const enSoil = {
  'soil.panel.title': 'Soil survey',
  'soil.panel.titleHere': 'What the soil survey says here',
  'soil.panel.loading': 'Looking up the soil survey...',
  'soil.panel.noData': 'The soil survey has no data for this spot.',
  'soil.panel.unavailable': 'Could not reach the soil survey. Try again later.',
  'soil.panel.retry': 'Try again',
  'soil.panel.offline':
    'The soil survey needs a connection. It is not saved on this device, so it shows only when you are online.',
  'soil.panel.notLocated':
    "Draw this Area on the map, or save your farm's location, to look up the soil survey.",
  'soil.panel.needLocation': "Save your farm's location to look up the soil survey.",
  'soil.panel.source': 'Source: USDA NRCS Soil Survey.',
  'soil.panel.sourceLink': 'Open Web Soil Survey',
  'soil.panel.scaleNote':
    'The survey is mapped at a broad scale. Your ground can differ from what it says.',
  'soil.panel.labNote': 'A lab soil test tells you what is in your soil today.',
  'soil.panel.labLink': 'Add a soil test',
  'soil.panel.labWins':
    'This describes the kind of soil mapped here. When you have a lab soil test, go by the lab test.',
  'soil.panel.approximate':
    "This is for your farm's location. Draw this Area on the map for a closer answer.",
  'soil.panel.farmLocation': "This is for your farm's saved location.",
  'soil.panel.flagsTitle': 'Worth knowing about this spot',
  'soil.panel.provLabel': 'Soil survey',
  'soil.panel.provLong': 'From the USDA NRCS soil survey for this spot, not from your own records.',

  'soil.line.name': 'What the survey calls this soil',
  'soil.line.name.note': 'Main soils mapped here: {list}.',
  'soil.line.texture': 'Top layer',
  'soil.line.drainage': 'Drainage',
  'soil.line.slope': 'Slope',
  'soil.line.waterTable': 'Depth to water in the wet season',
  'soil.line.bedrock': 'Depth to rock',
  'soil.line.flooding': 'Flooding',
  'soil.line.ph': 'Typical pH of the top layer',
  'soil.line.ph.note':
    "This is the survey's usual range for this kind of soil, not a test of your ground.",
  'soil.line.om': 'Organic matter in the top layer',
  'soil.line.om.note': "The survey's typical value for this kind of soil.",
  'soil.line.farmland': 'Farmland class',

  'soil.value.component': '{name} ({percent}%)',
  'soil.value.depthAbout': 'About {depth} down',
  'soil.value.noneNoted': 'None noted in the survey',
  'soil.value.percent': '{n}%',
  'soil.value.phRange': '{low} to {high}',
  'soil.value.phRangeTypical': '{low} to {high}, usually about {typical}',
  'soil.value.phTypical': 'About {typical}',
  'soil.value.slope': '{words} ({pct}%)',

  'soil.texture.sand': 'Sand',
  'soil.texture.sand.note': 'A loose, gritty soil that is almost all sand.',
  'soil.texture.loamySand': 'Loamy sand',
  'soil.texture.loamySand.note': 'A loose, gritty soil that is mostly sand.',
  'soil.texture.sandyLoam': 'Sandy loam',
  'soil.texture.sandyLoam.note': 'A light soil with a lot of sand.',
  'soil.texture.loam': 'Loam',
  'soil.texture.loam.note': 'An even mix of sand, silt and clay.',
  'soil.texture.siltLoam': 'Silt loam',
  'soil.texture.siltLoam.note': 'A smooth soil with a lot of silt.',
  'soil.texture.silt': 'Silt',
  'soil.texture.silt.note': 'A smooth, floury soil that is mostly silt.',
  'soil.texture.sandyClayLoam': 'Sandy clay loam',
  'soil.texture.sandyClayLoam.note': 'A fairly heavy soil with both sand and clay.',
  'soil.texture.clayLoam': 'Clay loam',
  'soil.texture.clayLoam.note': 'A heavy soil with a good share of clay.',
  'soil.texture.siltyClayLoam': 'Silty clay loam',
  'soil.texture.siltyClayLoam.note': 'A heavy soil with a lot of clay.',
  'soil.texture.sandyClay': 'Sandy clay',
  'soil.texture.sandyClay.note': 'A heavy soil that is mostly clay, with sand in it.',
  'soil.texture.siltyClay': 'Silty clay',
  'soil.texture.siltyClay.note': 'A heavy, sticky soil that is mostly clay and silt.',
  'soil.texture.clay': 'Clay',
  'soil.texture.clay.note': 'A very heavy, sticky soil that is mostly clay.',
  'soil.texture.organic': 'Muck or peat',
  'soil.texture.organic.note': 'A dark soil made mostly of rotted plants.',

  'soil.drainage.excessively': 'Excessively drained',
  'soil.drainage.excessively.note': 'Water runs through very fast, so the soil dries out quickly.',
  'soil.drainage.somewhatExcessively': 'Somewhat excessively drained',
  'soil.drainage.somewhatExcessively.note':
    'Water runs through fast, so the soil tends to dry out.',
  'soil.drainage.well': 'Well drained',
  'soil.drainage.well.note': 'Water drains away readily. The soil does not stay soggy for long.',
  'soil.drainage.moderatelyWell': 'Moderately well drained',
  'soil.drainage.moderatelyWell.note':
    'Water drains a little slowly. The soil can stay wet for a short time in wet seasons.',
  'soil.drainage.somewhatPoorly': 'Somewhat poorly drained',
  'soil.drainage.somewhatPoorly.note':
    'Water drains slowly. The soil stays wet for good parts of the year.',
  'soil.drainage.poorly': 'Poorly drained',
  'soil.drainage.poorly.note':
    'Water drains very slowly. The soil is wet near the surface for much of the year.',
  'soil.drainage.veryPoorly': 'Very poorly drained',
  'soil.drainage.veryPoorly.note': 'Water sits at or near the surface for most of the year.',

  'soil.slope.flat': 'Nearly flat',
  'soil.slope.gentle': 'Gentle slope',
  'soil.slope.moderate': 'Moderate slope',
  'soil.slope.steep': 'Steep',
  'soil.slope.verySteep': 'Very steep',

  'soil.flood.none': 'None',
  'soil.flood.veryRare': 'Very rare',
  'soil.flood.rare': 'Rare',
  'soil.flood.occasional': 'Occasional',
  'soil.flood.frequent': 'Frequent',
  'soil.flood.veryFrequent': 'Very frequent',

  'soil.farmland.notPrime': 'Not prime farmland',
  'soil.farmland.allPrime': 'All areas are prime farmland',
  'soil.farmland.statewide': 'Farmland of statewide importance',
  'soil.farmland.local': 'Farmland of local importance',
  'soil.farmland.unique': 'Farmland of unique importance',

  'soil.flag.wet.caution':
    'The survey classes this soil as poorly drained. Expect it to stay wet for much of the year.',
  'soil.flag.wet.note':
    'The survey classes this soil as somewhat poorly drained. Expect wet spells.',
  'soil.flag.droughty.note':
    'The survey says water runs through this soil fast. Expect it to dry out quickly.',
  'soil.flag.floods.caution': 'The survey says this ground floods often.',
  'soil.flag.floods.note': 'The survey says this ground floods now and then.',
  'soil.flag.hydric.note': 'The survey lists a wetland type of soil (hydric) here.',
  'soil.flag.highWaterTable.caution':
    'The survey shows water close to the surface in the wet season.',
  'soil.flag.highWaterTable.note':
    'The survey shows water fairly close to the surface in the wet season.',
  'soil.flag.shallowBedrock.caution': 'The survey shows rock close to the surface.',
  'soil.flag.shallowBedrock.note': 'The survey shows rock fairly close to the surface.',
  'soil.flag.steep.caution': 'This ground is steep. Water and soil can run off it.',
  'soil.flag.steep.note': 'This ground has a slope you will notice.',
  'soil.flag.notSoil.note':
    'The survey maps this spot as built-up or disturbed ground, so it has no soil details here.'
} as const;

/** General care tips by crop family for the Care Guide card. Plain cultural
 *  practice only: no products, rates or spray timing. Shown with `fallback`
 *  provenance because they are not specific to the variety. */

export interface FamilyCareTips {
  label: string;
  water: string[];
  feed: string[];
  prune: string[];
  problems: string[];
}

const DEEP_WATER = 'Water deeply once or twice a week so about an inch reaches the roots.';
const AT_THE_BASE = 'Water at the base in the morning so the leaves dry by evening.';
const LIGHT_FEED = 'Work compost into the bed before planting. Most gardens need little else.';

export const FAMILY_CARE_TIPS: Readonly<Record<string, FamilyCareTips>> = {
  solanaceae: {
    label: 'tomatoes, peppers and eggplant',
    water: [DEEP_WATER, 'Keep watering even. Dry spells followed by a soaking crack the fruit.'],
    feed: [
      'Mix compost into the planting hole.',
      'Side-dress with compost when the first fruit sets.'
    ],
    prune: [
      'Stake or cage at planting so roots are not damaged later.',
      'On tall vining tomatoes, pinch the small shoots that grow between the stem and a branch.',
      'Remove leaves touching the soil.'
    ],
    problems: [
      'Yellow lower leaves with dark rings: remove them, mulch, and keep water off the leaves.',
      'Dark sunken spot on the bottom of the fruit: uneven watering. Water more evenly.',
      'Leaves chewed overnight: look under the leaves for large green caterpillars and pick them off.'
    ]
  },
  cucurbit: {
    label: 'squash, cucumbers and melons',
    water: [DEEP_WATER, AT_THE_BASE],
    feed: [LIGHT_FEED, 'Side-dress with compost when the vines start to run.'],
    prune: [
      'Trellis cucumbers to keep fruit clean and straight.',
      'Pinch vine tips late in the season so the plant ripens the fruit it has.'
    ],
    problems: [
      'White powder on leaves: improve air flow and remove the worst leaves.',
      'Whole vine wilts suddenly: check the base of the stem for a hole with sawdust-like frass.',
      'Small fruit that shrivels: flowers were not pollinated. Leave room for bees.'
    ]
  },
  brassica: {
    label: 'cabbage, broccoli and kale',
    water: ['Keep the soil evenly moist. Heat and dry soil make them bolt or turn bitter.'],
    feed: [LIGHT_FEED, 'They are hungry plants. Side-dress with compost a month after planting.'],
    prune: ['No pruning needed. Pick outer kale leaves and leave the center to keep growing.'],
    problems: [
      'Holes in leaves with green droppings: look for small green caterpillars and pick them off.',
      'Tiny round holes on young plants: flea beetles. Row cover keeps them off.',
      'Broccoli flowers open yellow: it waited too long. Pick heads while the buds are tight.'
    ]
  },
  allium: {
    label: 'onions, garlic and leeks',
    water: ['Keep evenly moist until the tops start to fall over, then let them dry.'],
    feed: [LIGHT_FEED],
    prune: ['Cut garlic flower stalks (scapes) when they curl so the bulb grows bigger.'],
    problems: [
      'Tops yellow and fall over late in the season: that is normal and means harvest is near.',
      'Weeds crowd them out fast. Keep the bed weeded, since onions cannot shade weeds.'
    ]
  },
  'leafy-green': {
    label: 'lettuce, spinach and greens',
    water: ['Water lightly and often. Shallow roots dry out quickly.'],
    feed: [LIGHT_FEED],
    prune: ['Pick outer leaves and leave the center to keep growing.'],
    problems: [
      'Plant shoots up and turns bitter: heat makes it bolt. Sow again in cooler weather.',
      'Ragged holes and slime trails: slugs. Check under boards at dawn.'
    ]
  },
  root: {
    label: 'carrots, beets and radishes',
    water: ['Keep the top inch moist until seedlings are up, then water deeply.'],
    feed: ['Skip fresh manure. It makes forked roots.'],
    prune: ['Thin seedlings to their final spacing early. Crowded roots stay small.'],
    problems: [
      'Forked or twisted roots: stones or clumps in the soil. Loosen the bed deeper next time.',
      'Cracked roots: uneven watering.'
    ]
  },
  apiaceae: {
    label: 'carrots, parsley and dill',
    water: ['Keep the soil surface moist until seeds sprout. They can take two weeks.'],
    feed: [LIGHT_FEED],
    prune: ['Thin seedlings early so each plant has room.'],
    problems: [
      'Striped caterpillars on dill or parsley are swallowtail butterflies. Many growers share a plant with them.'
    ]
  },
  legume: {
    label: 'beans and peas',
    water: ['Water deeply when flowering and podding. Dry soil drops the flowers.'],
    feed: ['Beans and peas make much of their own nitrogen. Skip extra feeding.'],
    prune: ['Give peas and pole beans a trellis at planting.'],
    problems: [
      'Pods get tough and stringy: pick every few days to keep them tender.',
      'Leaves skeletonized by yellow spiny larvae: hand-pick and check under the leaves.'
    ]
  },
  corn: {
    label: 'corn',
    water: ['Water deeply when the tassels and silks appear. That is when it matters most.'],
    feed: ['Side-dress with compost when plants are knee high.'],
    prune: ['Plant in blocks of short rows, not one long row, so the ears fill out.'],
    problems: ['Ears with missing kernels: poor pollination. Plant in blocks next time.']
  },
  'herb-culinary': {
    label: 'herbs',
    water: ['Let the top inch dry between waterings. Most herbs dislike wet feet.'],
    feed: ['Go easy on feeding. Lean soil gives stronger flavor.'],
    prune: ['Pinch tips often to keep plants bushy, and pinch off flower buds on basil.'],
    problems: ['Leggy, floppy plants: not enough sun or not enough pinching.']
  },
  'small-fruit': {
    label: 'strawberries and blueberries',
    water: [DEEP_WATER, 'Mulch to keep roots cool and moist.'],
    feed: ['Feed lightly after harvest, not before.'],
    prune: [
      'Trim strawberry runners you do not want to root.',
      'Cut out the oldest blueberry canes in late winter.'
    ],
    problems: ['Birds find ripe berries first. Net the plants as fruit starts to color.']
  },
  bramble: {
    label: 'raspberries and blackberries',
    water: [DEEP_WATER],
    feed: [LIGHT_FEED],
    prune: [
      'After harvest, cut canes that fruited down to the ground.',
      'Keep the row narrow so air moves through.'
    ],
    problems: ['Fruit that molds on the cane: pick often and remove overripe berries.']
  },
  'vine-fruit': {
    label: 'grapes',
    water: ['Water young vines deeply. Established vines need little extra.'],
    feed: [LIGHT_FEED],
    prune: [
      "Prune hard in late winter. Most of last year's growth comes off.",
      'Pull a few leaves around the clusters in summer so they get light and air.'
    ],
    problems: ['White powder on leaves or fruit: open the canopy so it dries faster.']
  },
  'stone-fruit': {
    label: 'peaches, plums and cherries',
    water: ['Water deeply every week or two in dry spells, especially as fruit sizes.'],
    feed: ['Feed in early spring only.'],
    prune: [
      'Prune in late winter to an open center so light reaches the middle.',
      'Thin young fruit so they are a hand-width apart.'
    ],
    problems: ['Fruit with brown, fuzzy rot: pick up and remove fallen and rotten fruit.']
  },
  orchard: {
    label: 'fruit trees',
    water: ['Water young trees deeply each week in their first two summers.'],
    feed: ['Feed in early spring only.'],
    prune: [
      'Prune in late winter while dormant. Remove dead, crossing and inward branches.',
      'Thin young fruit so they are a hand-width apart.'
    ],
    problems: ['Fallen fruit spreads trouble. Pick it up through the season.']
  }
};

export function familyCareTips(family: string | null | undefined): FamilyCareTips | null {
  if (!family) return null;
  return FAMILY_CARE_TIPS[family] ?? null;
}

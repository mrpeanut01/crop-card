/** General care tips by crop family for the Care Guide card. Plain cultural
 *  practice only: no products, rates or spray timing. Shown with `fallback`
 *  provenance because they are not specific to the variety.
 *
 *  Every tip is quoted from an extension source in
 *  `apps/web/scripts/care-tips-sources.json` under its id, and the entry's
 *  `shipped` field holds this exact text (gate: careTips.sources.gate.test.ts).
 *  Ids are the tip's original research position and are never renumbered. */

export interface CareTip {
  id: string;
  text: string;
}

export interface FamilyCareTips {
  label: string;
  water: CareTip[];
  feed: CareTip[];
  prune: CareTip[];
  problems: CareTip[];
}

export const CARE_TIP_FIELDS = ['water', 'feed', 'prune', 'problems'] as const;

const COMPOST_SPRING_FALL = 'Add compost to the soil in spring or fall.';
const TREE_FEED = 'Feed in late winter. On sandy soil, give half in late winter and the rest in May.';
const THIN_FRUIT = 'Thin fruit when it is about the size of a nickel so the rest hang 6 to 8 inches apart.';
const THIN_CARROTS = 'Thin carrots to 2 to 3 inches between plants.';

export const FAMILY_CARE_TIPS: Readonly<Record<string, FamilyCareTips>> = {
  solanaceae: {
    label: 'tomatoes, peppers and eggplant',
    water: [
      { id: 'solanaceae.water.0', text: 'Aim for about an inch of water a week, from rain or watering.' }
    ],
    feed: [{ id: 'solanaceae.feed.0', text: COMPOST_SPRING_FALL }],
    prune: [{ id: 'solanaceae.prune.0', text: 'Put in stakes or cages at planting time.' }],
    problems: [
      {
        id: 'solanaceae.problems.0',
        text: 'Mulch keeps soil from splashing onto the leaves, which helps prevent fungal infection.'
      },
      {
        id: 'solanaceae.problems.1',
        text: 'Blossom-end rot can develop when soil moisture swings while the fruit grows.'
      },
      { id: 'solanaceae.problems.2', text: 'Hornworms are easily removed by hand.' }
    ]
  },
  cucurbit: {
    label: 'squash, cucumbers and melons',
    water: [
      { id: 'cucurbit.water.0', text: 'Cucumbers need about an inch of water a week, from rain or watering.' },
      {
        id: 'cucurbit.water.1',
        text: 'Water at the base in the early morning so the leaves have time to dry.'
      }
    ],
    feed: [{ id: 'cucurbit.feed.0', text: COMPOST_SPRING_FALL }],
    prune: [{ id: 'cucurbit.prune.0', text: 'Training cucumbers up a trellis gives straight fruit.' }],
    problems: [
      {
        id: 'cucurbit.problems.1',
        text: 'Vine wilts suddenly: look for a hole with sawdust-like frass pushed out of it.'
      },
      {
        id: 'cucurbit.problems.2',
        text: 'Poor fruit set can come from too little pollination. Cold, rain or cloudy weather can reduce it.'
      }
    ]
  },
  brassica: {
    label: 'cabbage, broccoli and kale',
    water: [{ id: 'brassica.water.0', text: 'Keep soil moisture even.' }],
    feed: [
      { id: 'brassica.feed.1', text: 'Side-dress established plants three to four weeks after transplanting.' }
    ],
    prune: [],
    problems: [
      {
        id: 'brassica.problems.0',
        text: 'Large ragged holes and green-brown droppings mean caterpillars. Pick them off by hand.'
      },
      {
        id: 'brassica.problems.1',
        text: 'Small round holes in the leaves: flea beetles. Row cover keeps them off.'
      },
      { id: 'brassica.problems.2', text: 'Pick broccoli while the flower buds are still tightly closed.' }
    ]
  },
  allium: {
    label: 'onions, garlic and leeks',
    water: [
      {
        id: 'allium.water.0',
        text: 'Stop watering when the bulbs reach full size and the tops begin to fall.'
      }
    ],
    feed: [{ id: 'allium.feed.0', text: COMPOST_SPRING_FALL }],
    prune: [
      {
        id: 'allium.prune.0',
        text: 'Cut garlic flower stalks (scapes) when they curl so the bulb grows bigger.'
      }
    ],
    problems: [
      { id: 'allium.problems.0', text: 'Harvest onions when about half the tops are falling over and dry.' },
      { id: 'allium.problems.1', text: 'Control weeds early. They can easily overtake young garlic.' }
    ]
  },
  'leafy-green': {
    label: 'lettuce, spinach and greens',
    water: [
      { id: 'leafy-green.water.0', text: 'Lettuce has shallow roots. Organic mulch helps hold soil moisture.' }
    ],
    feed: [],
    prune: [{ id: 'leafy-green.prune.0', text: 'Pick the older outer leaves first.' }],
    problems: [
      {
        id: 'leafy-green.problems.0',
        text: 'High summer heat usually causes bolting (a seed stalk) and bitter flavor.'
      },
      { id: 'leafy-green.problems.1', text: 'Slugs and snails may feed on the leaves.' }
    ]
  },
  root: {
    label: 'carrots, beets and radishes',
    water: [],
    feed: [],
    prune: [{ id: 'root.prune.0', text: THIN_CARROTS }],
    problems: [
      { id: 'root.problems.0', text: 'Carrots prefer loamy or sandy soil free of stones and clods.' },
      { id: 'root.problems.1', text: 'Cracked roots: uneven watering.' }
    ]
  },
  apiaceae: {
    label: 'carrots, parsley and dill',
    water: [],
    feed: [],
    prune: [{ id: 'apiaceae.prune.0', text: THIN_CARROTS }],
    problems: [
      {
        id: 'apiaceae.problems.0',
        text: 'The parsleyworm, a swallowtail butterfly caterpillar, feeds on carrot leaves.'
      }
    ]
  },
  legume: {
    label: 'beans and peas',
    water: [],
    feed: [
      {
        id: 'legume.feed.0',
        text: 'Beans team up with Rhizobium bacteria in the soil, which helps growth and yield.'
      }
    ],
    prune: [{ id: 'legume.prune.0', text: 'Put pole bean supports in place at planting time.' }],
    problems: []
  },
  corn: {
    label: 'corn',
    water: [
      {
        id: 'corn.water.0',
        text: 'Water matters most during pollination, when tassels and silks appear, and while the ears fill.'
      }
    ],
    feed: [],
    prune: [
      { id: 'corn.prune.0', text: 'Plant in blocks of short rows, not one long row, so the ears fill out.' }
    ],
    problems: []
  },
  'herb-culinary': {
    label: 'herbs',
    water: [
      { id: 'herb-culinary.water.0', text: 'Avoid soggy soil. Constant moisture encourages root rot.' }
    ],
    feed: [{ id: 'herb-culinary.feed.0', text: 'Go easy on feeding. Lean soil gives stronger flavor.' }],
    prune: [
      {
        id: 'herb-culinary.prune.0',
        text: 'Pinch basil stems as they lengthen to keep the plant bushy and compact.'
      }
    ],
    problems: [{ id: 'herb-culinary.problems.0', text: 'Thin, spindly growth: not enough light.' }]
  },
  'small-fruit': {
    label: 'strawberries and blueberries',
    water: [
      {
        id: 'small-fruit.water.1',
        text: 'A 2 to 3 inch mulch around blueberries keeps soil moisture more even.'
      }
    ],
    feed: [],
    prune: [
      {
        id: 'small-fruit.prune.1',
        text: 'On mature rabbiteye blueberries, remove the oldest or largest cane each winter from the fifth year on.'
      }
    ],
    problems: [
      {
        id: 'small-fruit.problems.0',
        text: 'Birds take ripe berries. Netting over the bushes is the only practical control.'
      }
    ]
  },
  bramble: {
    label: 'raspberries and blackberries',
    water: [],
    feed: [],
    prune: [
      {
        id: 'bramble.prune.0',
        text: 'Canes die after they fruit and will not bear again, so cut them out.'
      },
      {
        id: 'bramble.prune.1',
        text: 'Keep raspberry rows under 18 inches wide so air moves through and the lower canopy stays dry.'
      }
    ],
    problems: [{ id: 'bramble.problems.0', text: 'Pick ripe fruit often to cut down on fruit rot.' }]
  },
  'vine-fruit': {
    label: 'grapes',
    water: [],
    feed: [],
    prune: [
      {
        id: 'vine-fruit.prune.0',
        text: 'Prune while dormant in early March. Leave a spur every 8 to 12 inches along each cordon.'
      }
    ],
    problems: []
  },
  'stone-fruit': {
    label: 'peaches, plums and cherries',
    water: [],
    feed: [{ id: 'stone-fruit.feed.0', text: TREE_FEED }],
    prune: [
      {
        id: 'stone-fruit.prune.0',
        text: 'Train to an open center by removing the leader. Prune in late winter.'
      },
      { id: 'stone-fruit.prune.1', text: THIN_FRUIT }
    ],
    problems: [
      { id: 'stone-fruit.problems.0', text: 'Remove rotten fruit from the tree and the ground right away.' }
    ]
  },
  orchard: {
    label: 'fruit trees',
    water: [],
    feed: [{ id: 'orchard.feed.0', text: TREE_FEED }],
    prune: [
      { id: 'orchard.prune.0', text: 'Remove dead, diseased and broken branches.' },
      { id: 'orchard.prune.1', text: THIN_FRUIT }
    ],
    problems: [{ id: 'orchard.problems.0', text: 'Pick up and remove damaged or fallen fruit.' }]
  }
};

export function familyCareTips(family: string | null | undefined): FamilyCareTips | null {
  if (!family) return null;
  return FAMILY_CARE_TIPS[family] ?? null;
}

export function allCareTips(
  tips: Readonly<Record<string, FamilyCareTips>> = FAMILY_CARE_TIPS
): CareTip[] {
  return Object.values(tips).flatMap((f) => CARE_TIP_FIELDS.flatMap((field) => f[field]));
}

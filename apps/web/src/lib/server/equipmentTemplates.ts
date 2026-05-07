/**
 * Equipment template starter library (Phase 9).
 *
 * Static seed data — NOT a plugin type. Equipment instances live in the
 * `equipment` + `equipmentState` tables (mutable per-farm: hour meter,
 * decon timestamps, calibration). Templates are immutable suggestions
 * the user picks from when adding new equipment.
 *
 * Sources:
 *   - ATTRA Equipment & Tools for Small-Scale Intensive Crop Production
 *   - Penn State Extension small-farm equipment fact sheets
 *   - Manufacturer specs (BCS, Grillo, John Deere, Kubota, Mahindra, FIMCO)
 *
 * The /equipment/new picker reads this list; no registry / hash / Zod —
 * it's seed data.
 */

export type EquipmentType =
  | 'sprayer'
  | 'planter'
  | 'drill'
  | 'rake'
  | 'baler'
  | 'tractor'
  | 'mower'
  | 'irrigation'
  | 'other';

/**
 * Pre/post-task templates (Phase 12). When an operator schedules a primary
 * task that uses this equipment, matching pre-tasks auto-attach if their
 * conditions match. Conditions are evaluated against equipment state.
 *
 *   'always-before-use' — fires every time
 *   'last-used-gt-days' — fires when equipmentState.lastUsedAt is older than
 *                         conditionDays (or never used at all)
 *   'after-storage-period' — fires once after a >conditionDays gap
 */
export interface EquipmentPreTaskTemplate {
  key: string;
  title: string;
  body?: string;
  condition?: 'always-before-use' | 'last-used-gt-days' | 'after-storage-period';
  conditionDays?: number;
}
export interface EquipmentPostTaskTemplate {
  key: string;
  title: string;
  body?: string;
  condition?: 'always-after-use' | 'after-restricted-use-chemistry';
}

export interface EquipmentTemplate {
  templateId: string;
  type: EquipmentType;
  category: string;
  label: string;
  description: string;
  /** Free-form spec — surfaced in the equipment-detail UI. */
  spec?: Record<string, string | number>;
  /** Suggested default GPA calibration (sprayer-only). */
  defaultGpa?: number;
  /** Phase 12 — auto-attach pre-tasks when this equipment is used in a primary. */
  preTasks?: EquipmentPreTaskTemplate[];
  postTasks?: EquipmentPostTaskTemplate[];
}

export const SEED_EQUIPMENT_TEMPLATES: ReadonlyArray<EquipmentTemplate> = [
  // ─── Tractors ───────────────────────────────────────────────────────────
  {
    templateId: 'tractor-2wt-bcs',
    type: 'tractor',
    category: 'Two-wheel tractor',
    label: '2-wheel walk-behind tractor (BCS / Grillo)',
    description:
      'PTO-driven walking tractor with quick-change implements. Workhorse for ¼–2 acre vegetable plots.',
    spec: { hp: '8–16', driveType: 'walk-behind', ptoRpm: 990 }
  },
  {
    templateId: 'tractor-subcompact',
    type: 'tractor',
    category: 'Subcompact tractor',
    label: 'Subcompact utility tractor (sub-25 hp)',
    description: 'Diesel 4WD with cat-1 3-point hitch; ideal for small-farm tillage and mowing.',
    spec: { hp: '20–24', hitch: 'Cat-1', loaderReady: 'yes' }
  },
  {
    templateId: 'tractor-compact-utility',
    type: 'tractor',
    category: 'Compact utility tractor',
    label: 'Compact utility tractor (25–50 hp)',
    description:
      'Mid-range utility tractor — handles full-width tillage, baling, and PTO sprayers up to 200 gal.',
    spec: { hp: '25–50', hitch: 'Cat-1/2', ptoRpm: 540 }
  },
  {
    templateId: 'tractor-utility',
    type: 'tractor',
    category: 'Utility tractor',
    label: 'Utility tractor (50–100 hp)',
    description:
      'Standard farm tractor for hay operations, large planters, and 200+ gal pull sprayers.',
    spec: { hp: '50–100', hitch: 'Cat-2', ptoRpm: '540/1000' }
  },
  {
    templateId: 'tractor-row-crop',
    type: 'tractor',
    category: 'Row-crop tractor',
    label: 'Row-crop tractor (100+ hp)',
    description:
      'High-clearance row-crop tractor for corn / soybean operations. Adjustable wheel track.',
    spec: { hp: '100–200', hitch: 'Cat-2/3', ptoRpm: '540E/1000' }
  },

  // ─── Sprayers ───────────────────────────────────────────────────────────
  {
    templateId: 'sprayer-backpack-4gal',
    type: 'sprayer',
    category: 'Backpack sprayer',
    label: '4 gal backpack sprayer (Solo / Birchmeier)',
    description:
      'Manual diaphragm pump backpack. Spot-spray + small-plot use; calibrate to walking pace.',
    spec: { tankGal: 4, pumpType: 'manual diaphragm' },
    defaultGpa: 30,
    preTasks: [
      {
        key: 'backpack-pump-test',
        title: 'Pump test + nozzle pattern check',
        body: 'Pressurize with water; inspect spray pattern for clogged orifice or warped tip.',
        condition: 'always-before-use'
      }
    ],
    postTasks: [
      {
        key: 'backpack-decon-rinse',
        title: 'Triple-rinse + air-dry tank',
        body: 'Backpack tanks pickle if hot product sits overnight. Rinse and hang upside-down.',
        condition: 'after-restricted-use-chemistry'
      }
    ]
  },
  {
    templateId: 'sprayer-25gal-atv',
    type: 'sprayer',
    category: 'ATV-mount sprayer',
    label: '25 gal ATV/UTV-mount sprayer',
    description: '12V pump, boomless or 3-nozzle boom; for orchard rows and row-crop spot work.',
    spec: { tankGal: 25, pump: '12V Shurflo', boomFt: 6 },
    defaultGpa: 15,
    preTasks: [
      {
        key: 'atv-12v-pump-test',
        title: 'Run pump dry-test → check pressure switch',
        body: '12V pumps fail silently with corroded contacts after sitting. Verify rated psi.',
        condition: 'last-used-gt-days',
        conditionDays: 30
      },
      {
        key: 'atv-pre-mix-calibration',
        title: 'Confirm 1/128-acre calibration',
        body: 'Re-walk calibration if last cal >30d ago.',
        condition: 'last-used-gt-days',
        conditionDays: 30
      }
    ],
    postTasks: [
      {
        key: 'atv-decon-restricted',
        title: 'Tank decon — chemistry switch',
        condition: 'after-restricted-use-chemistry'
      }
    ]
  },
  {
    templateId: 'sprayer-50gal-pull',
    type: 'sprayer',
    category: 'Pull-behind sprayer',
    label: '50 gal pull-behind boom sprayer',
    description: '12V on-demand pump with 3-section 12-ft boom. Ground-driven or pump-driven.',
    spec: { tankGal: 50, boomFt: 12, sections: 3 },
    defaultGpa: 15,
    preTasks: [
      {
        key: 'sprayer-spring-startup',
        title: 'Spring-startup check after winter storage',
        body: 'Inspect hoses for cracks, replace any nozzles >50 hr, run 5 gal water + 1 oz dish soap through the system.',
        condition: 'after-storage-period',
        conditionDays: 90
      },
      {
        key: 'sprayer-pre-mix-calibration',
        title: 'Confirm 1/128-acre calibration',
        body: 'Re-walk the calibration if last calibration was >30 d ago — nozzle wear changes the GPA.',
        condition: 'last-used-gt-days',
        conditionDays: 30
      }
    ],
    postTasks: [
      {
        key: 'sprayer-decon-restricted',
        title: 'Tank decon — chemistry switch',
        body: 'Run the kernel-prescribed decon sequence (ammonia rinse, etc.) before next use with a different chemistry class.',
        condition: 'after-restricted-use-chemistry'
      }
    ]
  },
  {
    templateId: 'sprayer-100gal-pull',
    type: 'sprayer',
    category: 'Pull-behind sprayer',
    label: '100 gal pull-behind boom sprayer',
    description: 'PTO-driven roller pump, hydraulic boom fold, mechanical agitation.',
    spec: { tankGal: 100, boomFt: 18, agitation: 'mechanical' },
    defaultGpa: 15,
    preTasks: [
      {
        key: 'pull100-spring-startup',
        title: 'Spring-startup: roller-pump prime + boom-fold hydraulics',
        body: 'Inspect rollers (replace if grooved); cycle boom fold for sticky cylinders.',
        condition: 'after-storage-period',
        conditionDays: 90
      },
      {
        key: 'pull100-calibration',
        title: 'Re-calibrate GPA at boom pressure',
        condition: 'last-used-gt-days',
        conditionDays: 30
      }
    ],
    postTasks: [
      {
        key: 'pull100-decon-restricted',
        title: 'Tank decon — chemistry switch',
        condition: 'after-restricted-use-chemistry'
      }
    ]
  },
  {
    templateId: 'sprayer-200gal-3pt',
    type: 'sprayer',
    category: '3-point sprayer',
    label: '200 gal 3-point boom sprayer',
    description:
      'Cat-2 3-pt hitch, PTO roller pump, jet agitation, 21-ft boom. Standard for row-crop work.',
    spec: { tankGal: 200, boomFt: 21, agitation: 'jet', hitch: 'Cat-2' },
    defaultGpa: 15,
    preTasks: [
      {
        key: 's200-spring-startup',
        title: 'Spring-startup + agitation jet check',
        body: 'Jet agitation clogs with old residue. Run 50 gal water + flush all return-to-tank lines.',
        condition: 'after-storage-period',
        conditionDays: 90
      },
      {
        key: 's200-calibration',
        title: 'Re-calibrate GPA',
        condition: 'last-used-gt-days',
        conditionDays: 30
      }
    ],
    postTasks: [
      {
        key: 's200-decon-restricted',
        title: 'Tank decon — chemistry switch',
        condition: 'after-restricted-use-chemistry'
      }
    ]
  },
  {
    templateId: 'sprayer-airblast-100gal',
    type: 'sprayer',
    category: 'Orchard airblast sprayer',
    label: '100 gal orchard airblast sprayer',
    description:
      'PTO-driven airblast for tree fruit canopies — fungicide + insecticide cover sprays.',
    spec: { tankGal: 100, fanDiameterIn: 30, hitch: 'PTO' },
    defaultGpa: 50,
    preTasks: [
      {
        key: 'airblast-fan-bearings',
        title: 'Inspect fan bearings + PTO shaft guards',
        body: 'Airblast fan spins fast; failed bearings throw blades. Bearings + shields BEFORE first run each season.',
        condition: 'after-storage-period',
        conditionDays: 90
      },
      {
        key: 'airblast-nozzle-pattern',
        title: 'Check nozzle pattern — airblast canopy coverage',
        body: 'Spot-test pattern with water on a target tree; uneven nozzle wear is the most common quality issue.',
        condition: 'always-before-use'
      }
    ],
    postTasks: [
      {
        key: 'airblast-decon-restricted',
        title: 'Tank decon — chemistry switch',
        condition: 'after-restricted-use-chemistry'
      }
    ]
  },

  // ─── Tillage + bed prep ─────────────────────────────────────────────────
  {
    templateId: 'tiller-pto-rotary-60',
    type: 'other',
    category: 'Rotary tiller',
    label: '60 in PTO rotary tiller',
    description: 'Cat-1 3-pt rotary tiller. Primary tillage for raised-bed prep.',
    spec: { workingWidthIn: 60, depth: '6 in', hitch: 'Cat-1' }
  },
  {
    templateId: 'disc-harrow-6ft',
    type: 'other',
    category: 'Disc harrow',
    label: '6 ft pull-behind disc harrow',
    description: 'Tandem-gang disc harrow for residue incorporation and seedbed prep.',
    spec: { workingWidthFt: 6, gangs: 2 }
  },
  {
    templateId: 'chisel-plow-7shank',
    type: 'other',
    category: 'Chisel plow',
    label: '7-shank chisel plow',
    description: 'Cat-2 mounted chisel plow for deep tillage and compaction relief.',
    spec: { shankCount: 7, depthIn: 12, hitch: 'Cat-2' }
  },
  {
    templateId: 'bed-shaper-30in',
    type: 'other',
    category: 'Bed shaper',
    label: '30 in raised-bed shaper',
    description: 'Forms 4–10 in raised beds with optional plastic + drip layer.',
    spec: { bedWidthIn: 30, addOns: 'plastic-mulch + drip' }
  },
  {
    templateId: 'power-harrow-walking',
    type: 'other',
    category: 'Power harrow',
    label: 'Walk-behind power harrow (BCS-compatible)',
    description:
      '32 in PTO power harrow for stale-bedding and fine seedbed prep without inversion.',
    spec: { workingWidthIn: 32, depth: '4 in' }
  },

  // ─── Planting ───────────────────────────────────────────────────────────
  {
    templateId: 'seeder-walkbehind-earthway',
    type: 'planter',
    category: 'Walk-behind seeder',
    label: 'Earthway 1001-B walk-behind seeder',
    description: '6 interchangeable seed plates; standard small-farm precision seeder.',
    spec: { rows: 1, seedPlates: 6 }
  },
  {
    templateId: 'seeder-jang-jp1',
    type: 'planter',
    category: 'Walk-behind seeder',
    label: 'Jang JP-1 push seeder (single-row)',
    description: 'Roller-based precision push seeder for greens, brassicas, alliums.',
    spec: { rows: 1, rollerOptions: 'multiple-rollers-available' }
  },
  {
    templateId: 'planter-2row-plate',
    type: 'planter',
    category: 'Plate planter',
    label: '2-row mechanical plate planter (Cole / Covington)',
    description:
      '2-row plate planter for corn / soybean / pumpkin / cucurbit; 30–40 in row spacing.',
    spec: { rows: 2, rowSpacingIn: '30–40' },
    preTasks: [
      {
        key: 'planter-chain-inspection',
        title: 'Inspect drive chains + grease zerks after winter sit',
        body: 'Spin each row unit by hand; tension chains; pump grease into all zerks.',
        condition: 'after-storage-period',
        conditionDays: 120
      },
      {
        key: 'planter-plate-match',
        title: 'Confirm seed plates match the variety',
        body: 'Plate cell size = ~1.1× seed size. Wrong plate skips or doubles.',
        condition: 'always-before-use'
      }
    ]
  },
  {
    templateId: 'no-till-drill-7ft',
    type: 'drill',
    category: 'No-till drill',
    label: '7 ft no-till drill (Great Plains / Esch)',
    description: 'Coulter-based no-till drill for cover crops, small grains, hay seedings.',
    spec: { workingWidthFt: 7, rowsCount: 12 },
    preTasks: [
      {
        key: 'drill-coulter-bearings',
        title: 'Inspect coulter + opener bearings; spin freely',
        condition: 'last-used-gt-days',
        conditionDays: 60
      },
      {
        key: 'drill-seed-rate-calibration',
        title: 'Run seed-rate calibration for chosen species',
        body: 'Drill seed cups vary by species size; verify lb/ac with a static calibration before in-field run.',
        condition: 'always-before-use'
      }
    ]
  },
  {
    templateId: 'transplanter-mechanical',
    type: 'planter',
    category: 'Transplanter',
    label: 'Water-wheel mechanical transplanter (Mechanical Transplanter / Holland)',
    description:
      'Pulled water-wheel transplanter — 2 operators, 1 row at a time. For tomato, pepper, brassica plug starts.',
    spec: { rows: 1, operators: 2 },
    preTasks: [
      {
        key: 'transplanter-water-tank-flush',
        title: 'Flush + fill water tank; check drip valves',
        body: 'Stagnant water + algae clog drip valves. Flush + add fresh water with optional starter fertilizer.',
        condition: 'always-before-use'
      },
      {
        key: 'transplanter-wheel-spacing',
        title: 'Set water-wheel spacing for plug spacing',
        condition: 'always-before-use'
      }
    ]
  },
  {
    templateId: 'transplanter-paperpot',
    type: 'planter',
    category: 'Paper-pot transplanter',
    label: 'Paper Pot Transplanter (HP-262 / 264)',
    description:
      'Walk-behind paper-pot transplanter for high-density greens, alliums, and salad mix.',
    spec: { paperPotsPerChain: 264 }
  },

  // ─── Mowing + hay ───────────────────────────────────────────────────────
  {
    templateId: 'mower-rotary-cutter-5ft',
    type: 'mower',
    category: 'Rotary cutter',
    label: '5 ft rotary cutter (brush hog)',
    description: 'Cat-1/2 PTO rotary cutter for pasture, fence-line, and rough mowing.',
    spec: { workingWidthFt: 5, hitch: 'Cat-1/2' }
  },
  {
    templateId: 'mower-finish-5ft',
    type: 'mower',
    category: 'Finish mower',
    label: '5 ft 3-point finish mower',
    description: 'Lawn-quality finish mower for orchard floor and lawn maintenance.',
    spec: { workingWidthFt: 5, hitch: 'Cat-1' }
  },
  {
    templateId: 'mower-flail-6ft',
    type: 'mower',
    category: 'Flail mower',
    label: '6 ft flail mower',
    description:
      'Cover-crop and crop-residue flail mower; finer cut than rotary, better for biomass distribution.',
    spec: { workingWidthFt: 6, hitch: 'Cat-1/2' }
  },
  {
    templateId: 'mower-disc-mower-conditioner',
    type: 'mower',
    category: 'Mower-conditioner',
    label: '9 ft disc mower-conditioner',
    description: 'Hay mower-conditioner with rubber rolls; first step in hay operation.',
    spec: { workingWidthFt: 9, conditionerType: 'rubber-roll' },
    preTasks: [
      {
        key: 'discmower-blade-bolt-torque',
        title: 'Torque-check disc blade bolts',
        body: 'Disc-cutter bolts loosen with use; loose bolt + rock = thrown blade. Check before each first cut.',
        condition: 'always-before-use'
      },
      {
        key: 'discmower-spring-startup',
        title: 'Inspect roll-clearance + driveline U-joints',
        body: 'After winter sit, U-joints can seize and conditioner rolls can develop flat spots. Spin freely first.',
        condition: 'after-storage-period',
        conditionDays: 90
      }
    ]
  },
  {
    templateId: 'tedder-4basket',
    type: 'rake',
    category: 'Hay tedder',
    label: '4-basket hay tedder',
    description: 'Spreads + flips windrows for faster drying. Cat-1 3-pt.',
    spec: { baskets: 4, workingWidthFt: 17 },
    preTasks: [
      {
        key: 'tedder-tine-replace',
        title: 'Inspect + replace bent / missing tines',
        body: 'Bent tines leave hay on the ground. Check + grease basket spindles.',
        condition: 'always-before-use'
      },
      {
        key: 'tedder-bearings',
        title: 'Lube basket spindle bearings after long sit',
        condition: 'last-used-gt-days',
        conditionDays: 90
      }
    ]
  },
  {
    templateId: 'rake-side-delivery',
    type: 'rake',
    category: 'Hay rake',
    label: 'Side-delivery hay rake',
    description: 'Single-rotor rake for forming windrows ahead of baling.',
    spec: { workingWidthFt: 9 },
    preTasks: [
      {
        key: 'rake-tine-replace',
        title: 'Replace missing / broken rake teeth',
        body: 'Missing teeth leave skips in the windrow → bale weight inconsistency.',
        condition: 'always-before-use'
      },
      {
        key: 'rake-bearings',
        title: 'Lube rotor bearings + check chain tension',
        condition: 'last-used-gt-days',
        conditionDays: 90
      }
    ]
  },
  {
    templateId: 'baler-small-square',
    type: 'baler',
    category: 'Small square baler',
    label: 'Small square baler (40–60 lb bales)',
    description: 'Pickup-style square baler. Small-farm hay standard.',
    spec: { baleSize: '14×18×36 in', baleWeightLb: '40–60' },
    preTasks: [
      {
        key: 'baler-bearings-check',
        title: 'Check bearings + grease zerks after long sit',
        body: 'Squeak-test the pickup, plunger, and knotter shafts. Pump grease until fresh purge appears.',
        condition: 'last-used-gt-days',
        conditionDays: 90
      },
      {
        key: 'baler-twine-knotter',
        title: 'Test-bale 2 windrows + inspect every knot',
        body: 'Mis-tied knots waste twine and dump bales. First 2 bales each session are the canary.',
        condition: 'always-before-use'
      }
    ]
  },
  {
    templateId: 'baler-round-4x4',
    type: 'baler',
    category: 'Round baler',
    label: '4×4 round baler',
    description: 'Compact round baler — bales fit in standard pickup beds; ~600 lb dry hay.',
    spec: { baleSize: '4×4 ft', baleWeightLb: 600 },
    preTasks: [
      {
        key: 'roundbaler-belt-inspection',
        title: 'Inspect bale-forming belts for cracks / fraying',
        body: 'Frayed belts slip and form lopsided bales. Replace before season if any visible damage.',
        condition: 'after-storage-period',
        conditionDays: 90
      },
      {
        key: 'roundbaler-bearings',
        title: 'Grease pickup + roller bearings',
        condition: 'last-used-gt-days',
        conditionDays: 90
      },
      {
        key: 'roundbaler-test-bale',
        title: 'Form 1 test bale + check density',
        condition: 'always-before-use'
      }
    ]
  },

  // ─── Irrigation ─────────────────────────────────────────────────────────
  {
    templateId: 'irrigation-drip-tape',
    type: 'irrigation',
    category: 'Drip tape system',
    label: 'Drip tape irrigation kit (1 acre, single zone)',
    description:
      '15 mil drip tape, header line, valve, screen filter, pressure regulator. Standard for raised-bed vegetables.',
    spec: { tapeMil: 15, emitterSpacingIn: 12, gph: 0.4 }
  },
  {
    templateId: 'irrigation-overhead-traveler',
    type: 'irrigation',
    category: 'Traveling gun',
    label: 'Traveling gun irrigation (1.5 in hose)',
    description: 'Hose-reel traveler for pasture, hay, and pre-plant water-up. 200–400 gpm.',
    spec: { gpm: '200–400', hoseFt: 1000 }
  },

  // ─── Other ──────────────────────────────────────────────────────────────
  {
    templateId: 'manure-spreader-pull',
    type: 'other',
    category: 'Manure spreader',
    label: '50 bu pull-behind manure spreader',
    description: 'Ground-driven beater spreader for poultry litter / dairy compost.',
    spec: { capacityBu: 50, drive: 'ground-driven' }
  },
  {
    templateId: 'broadcast-spreader-3pt',
    type: 'other',
    category: 'Broadcast spreader',
    label: '500 lb 3-pt broadcast spreader (cone-type)',
    description:
      'Cat-1 PTO broadcast spreader for granular fertilizer + lime. 30 ft swath at 540 RPM.',
    spec: { capacityLb: 500, swathFt: 30 }
  },
  {
    templateId: 'flame-weeder-backpack',
    type: 'other',
    category: 'Flame weeder',
    label: 'Backpack flame weeder (Red Dragon)',
    description: '5 lb propane backpack flame weeder for pre-emerge weed kill in stale beds.',
    spec: { propaneLb: 5, btu: 100000 }
  },
  {
    templateId: 'greens-harvester-quickcut',
    type: 'other',
    category: 'Greens harvester',
    label: 'Quick Cut Greens Harvester',
    description:
      'Battery-powered serrated bar harvester for salad mix and baby greens. ~30× faster than knife.',
    spec: { cutWidthIn: 14, batteryVolt: 18 }
  }
];

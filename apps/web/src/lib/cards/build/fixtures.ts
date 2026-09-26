import { FARM_SNAPSHOT_VERSION, type FarmSnapshot } from '../snapshot';

const at = (iso: string) => Date.parse(iso);

/** A small mixed farm: a hayfield, a kitchen garden with beds, and a barn. */
export function sampleSnapshot(overrides: Partial<FarmSnapshot> = {}): FarmSnapshot {
  return {
    version: FARM_SNAPSHOT_VERSION,
    ownerId: 'owner_a',
    farmName: 'Goose Creek',
    generatedAt: at('2026-06-01T13:00:00Z'),
    rulesVersion: '0.5.6-issue130',
    origin: 'https://app.cropcard.io',
    areas: [
      {
        id: 'f_hay',
        name: 'Hayfield',
        kind: 'pasture',
        acres: 20,
        widthFt: null,
        lengthFt: null,
        perimeterFt: 3900,
        acresSource: 'geometry',
        notes: null
      },
      {
        id: 'f_garden',
        name: 'Kitchen Garden',
        kind: 'garden',
        acres: null,
        widthFt: 30,
        lengthFt: 40,
        perimeterFt: null,
        acresSource: null,
        notes: 'Drip on beds 1-3'
      },
      {
        id: 'f_barn',
        name: '',
        kind: 'barn',
        acres: null,
        widthFt: 40,
        lengthFt: 60,
        perimeterFt: null,
        acresSource: null,
        notes: null
      }
    ],
    blocks: [
      {
        id: 'b_hay',
        areaId: 'f_hay',
        name: 'North cut',
        blockLabel: 'A',
        kind: 'block',
        acres: 20,
        widthFt: null,
        lengthFt: null,
        layout: null
      },
      {
        id: 'b_bed1',
        areaId: 'f_garden',
        name: 'Bed 1',
        blockLabel: null,
        kind: 'bed',
        acres: null,
        widthFt: 4,
        lengthFt: 8,
        layout: { xFt: 2, yFt: 2, rotationDeg: 0, bedStyle: 'raised' }
      },
      {
        id: 'b_bed3',
        areaId: 'f_garden',
        name: 'Bed 3',
        blockLabel: null,
        kind: 'bed',
        acres: null,
        widthFt: 4,
        lengthFt: 8,
        layout: { xFt: 14, yFt: 2, rotationDeg: 90, bedStyle: 'raised' }
      },
      {
        id: 'b_pot',
        areaId: 'f_garden',
        name: '',
        blockLabel: '2',
        kind: 'container',
        acres: null,
        widthFt: null,
        lengthFt: null,
        layout: null
      }
    ],
    plantings: [
      {
        id: 'p_tom',
        blockId: 'b_bed3',
        cropPluginId: 'tomato-cherokee-purple',
        varietyDisplayName: 'Cherokee Purple tomato',
        status: 'active',
        plantingDate: '2026-05-04',
        harvestedAt: null,
        quantityPlanted: null,
        quantityUnit: null,
        spacingIn: null,
        rowSpacingIn: null,
        plantCount: 6,
        plantCountProvenance: 'data',
        sourceProvenance: null
      },
      {
        id: 'p_bean',
        blockId: 'b_bed1',
        cropPluginId: 'bean-provider',
        varietyDisplayName: 'Provider bush bean',
        status: 'planned',
        plantingDate: '2026-06-10',
        harvestedAt: null,
        quantityPlanted: null,
        quantityUnit: null,
        spacingIn: 3,
        rowSpacingIn: 18,
        plantCount: null,
        plantCountProvenance: null,
        sourceProvenance: 'ai'
      },
      {
        id: 'p_alf',
        blockId: 'b_hay',
        cropPluginId: 'missing-plugin',
        varietyDisplayName: 'Alfalfa',
        status: 'active',
        plantingDate: null,
        harvestedAt: null,
        quantityPlanted: 1850,
        quantityUnit: 'lb',
        spacingIn: null,
        rowSpacingIn: null,
        plantCount: null,
        plantCountProvenance: null,
        sourceProvenance: null
      }
    ],
    tasks: [
      {
        id: 't_stake',
        title: 'Stake + prune suckers',
        category: 'prune',
        scheduledFor: at('2026-06-04T12:00:00Z'),
        cropId: 'p_tom',
        blockId: 'b_bed3',
        equipmentId: null
      },
      {
        id: 't_scout',
        title: 'Scout for hornworms',
        category: 'scout',
        scheduledFor: at('2026-06-12T12:00:00Z'),
        cropId: 'p_tom',
        blockId: null,
        equipmentId: null
      },
      {
        id: 't_side',
        title: 'Side-dress',
        category: 'fertilize',
        scheduledFor: at('2026-05-30T12:00:00Z'),
        cropId: 'p_tom',
        blockId: null,
        equipmentId: null
      },
      {
        id: 't_mow',
        title: 'First cutting',
        category: 'hay-cutting',
        scheduledFor: at('2026-06-20T12:00:00Z'),
        cropId: null,
        blockId: 'b_hay',
        equipmentId: null
      }
    ],
    equipment: [],
    stock: [],
    cropPlugins: {
      'tomato-cherokee-purple': {
        pluginId: 'tomato-cherokee-purple',
        displayName: 'Tomato — Cherokee Purple',
        version: '1.0.0',
        cropFamily: 'solanaceae',
        archetype: 'continuous-harvest-fruit',
        daysToMaturity: { min: 72, max: 80 },
        defaultRowSpacingInches: 48,
        preHarvestIntervalDays: 14,
        plantingGuide: { rowSpacingIn: 48, inRowSpacingIn: { min: 18, max: 24 }, soilTempMinF: 60 },
        harvestIndicators: ['Shoulders turn dusky purple', 'Slight give when pressed']
      },
      'bean-provider': {
        pluginId: 'bean-provider',
        displayName: 'Bean — Provider',
        version: '1.1.0',
        cropFamily: 'legume',
        daysToMaturity: { min: 50, max: 50 },
        defaultRowSpacingInches: 30
      }
    },
    frost: null,
    ...overrides
  };
}

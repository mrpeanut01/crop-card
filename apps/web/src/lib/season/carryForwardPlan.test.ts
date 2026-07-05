import { describe, expect, it } from 'vitest';

import {
  buildCalibrationHandoff,
  buildRotationSuggestion,
  classifyStockCarry,
  clonePlantings,
  nCreditFromTerminatedCovers,
  rotationLookbackDefault,
  shiftOneYear,
  summarizeCarryForward,
  type BlockRotationInput,
  type CarryForwardSeasonResult,
  type PlantingCloneCandidate,
  type PriorPlanting,
  type ScheduleWindowLite,
  type SprayerCalibrationSnapshot,
  type StockLotSnapshot,
  type TerminatedCoverSnapshot
} from './carryForwardPlan';

const DAY = 86_400_000;

function planting(over: Partial<PriorPlanting> = {}): PriorPlanting {
  return {
    cropPluginId: 'sweet-corn-ambrosia',
    cropFamily: 'corn',
    varietyDisplayName: 'Ambrosia',
    archetype: 'row-grain.pollination',
    plantingDateMs: Date.UTC(2025, 4, 15),
    status: 'harvested',
    ...over
  };
}

// ─── 1. Rotation advisor ───────────────────────────────────────────────────

describe('buildRotationSuggestion', () => {
  const empty: BlockRotationInput = { blockId: 'b1', blockName: 'North', priorPlantings: [] };

  it('returns ok with a friendly message when no prior planting', () => {
    const r = buildRotationSuggestion(empty, {}, 2025, 2026);
    expect(r.severity).toBe('ok');
    expect(r.priorFamilies).toEqual([]);
    expect(r.avoidFamilies).toEqual([]);
    expect(r.message).toMatch(/free to plant/i);
  });

  it('suggests (not warns) same-family repeat inside a 2-year lookback', () => {
    const block: BlockRotationInput = {
      blockId: 'b1',
      blockName: 'North',
      priorPlantings: [planting({ cropFamily: 'solanaceae' })]
    };
    // gap = 1 year, lookback = 2 → violation, lookback < 3 → suggest
    const r = buildRotationSuggestion(block, { solanaceae: 2 }, 2025, 2026);
    expect(r.severity).toBe('suggest');
    expect(r.avoidFamilies).toEqual(['solanaceae']);
    expect(r.message).toMatch(/consider rotating/i);
  });

  it('warns on a same-family repeat inside a >=3-year plant-back window', () => {
    const block: BlockRotationInput = {
      blockId: 'b1',
      blockName: 'North',
      priorPlantings: [planting({ cropFamily: 'brassica' })]
    };
    const r = buildRotationSuggestion(block, { brassica: 4 }, 2025, 2026);
    expect(r.severity).toBe('warn');
    expect(r.avoidFamilies).toEqual(['brassica']);
    expect(r.message).toMatch(/4-year plant-back/);
  });

  it('is ok when the fallow gap clears the lookback window', () => {
    const block: BlockRotationInput = {
      blockId: 'b1',
      blockName: 'North',
      priorPlantings: [planting({ cropFamily: 'brassica' })]
    };
    // gap = 3 (2022 → 2025), lookback = 3 → 3 >= 3 → outside window
    const r = buildRotationSuggestion(block, { brassica: 3 }, 2022, 2025);
    expect(r.severity).toBe('ok');
    expect(r.avoidFamilies).toEqual([]);
    expect(r.priorFamilies).toEqual(['brassica']);
  });

  it('uses the default lookback (1) for families absent from the map', () => {
    expect(rotationLookbackDefault()).toBe(1);
    const block: BlockRotationInput = {
      blockId: 'b1',
      blockName: 'North',
      priorPlantings: [planting({ cropFamily: 'mystery-family' })]
    };
    const r = buildRotationSuggestion(block, {}, 2025, 2026);
    // gap = 1, default lookback = 1 → 1 < 1 is false → ok
    expect(r.severity).toBe('ok');
  });

  it('picks the worst severity across multiple prior families', () => {
    const block: BlockRotationInput = {
      blockId: 'b1',
      blockName: 'North',
      priorPlantings: [
        planting({ cropFamily: 'legume' }),
        planting({ cropFamily: 'brassica' }),
        planting({ cropFamily: 'corn' })
      ]
    };
    const r = buildRotationSuggestion(block, { legume: 2, brassica: 4, corn: 2 }, 2025, 2026);
    expect(r.severity).toBe('warn');
    expect(r.avoidFamilies).toEqual(['brassica', 'corn', 'legume']);
    expect(r.priorFamilies).toEqual(['brassica', 'corn', 'legume']);
  });

  it('ignores failed / archived prior plantings', () => {
    const block: BlockRotationInput = {
      blockId: 'b1',
      blockName: 'North',
      priorPlantings: [
        planting({ cropFamily: 'brassica', status: 'failed' }),
        planting({ cropFamily: 'brassica', status: 'archived' })
      ]
    };
    const r = buildRotationSuggestion(block, { brassica: 4 }, 2025, 2026);
    expect(r.severity).toBe('ok');
    expect(r.priorFamilies).toEqual([]);
  });

  it('counts planned/active plantings toward the lookback', () => {
    const block: BlockRotationInput = {
      blockId: 'b1',
      blockName: 'North',
      priorPlantings: [planting({ cropFamily: 'corn', status: 'active' })]
    };
    const r = buildRotationSuggestion(block, { corn: 2 }, 2025, 2026);
    expect(r.severity).toBe('suggest');
  });
});

// ─── 2. Stock roll-forward ─────────────────────────────────────────────────

describe('classifyStockCarry', () => {
  const NOW = Date.UTC(2025, 10, 1); // Nov 1 2025
  const SEASON_START = Date.UTC(2026, 3, 15); // Apr 15 2026 (next season)

  function lot(over: Partial<StockLotSnapshot> = {}): StockLotSnapshot {
    return {
      lotId: 'lot1',
      stockItemId: 'item1',
      displayName: 'Roundup PowerMAX',
      category: 'herbicide',
      balance: 2.5,
      unit: 'gal',
      expiresAtMs: null,
      ...over
    };
  }

  it('rolls a non-expiring lot', () => {
    const [d] = classifyStockCarry([lot()], NOW, SEASON_START);
    expect(d.disposition).toBe('roll');
  });

  it('rolls a lot expiring well after the flag window', () => {
    const [d] = classifyStockCarry([lot({ expiresAtMs: Date.UTC(2027, 0, 1) })], NOW, SEASON_START);
    expect(d.disposition).toBe('roll');
  });

  it('marks a lot already past expiry as expired', () => {
    const [d] = classifyStockCarry([lot({ expiresAtMs: Date.UTC(2025, 5, 1) })], NOW, SEASON_START);
    expect(d.disposition).toBe('expired');
    expect(d.reason).toMatch(/past expiry/i);
  });

  it('flags a lot expiring within the first 45 days of the new season', () => {
    const [d] = classifyStockCarry(
      [lot({ expiresAtMs: SEASON_START + 10 * DAY })],
      NOW,
      SEASON_START
    );
    expect(d.disposition).toBe('flag-expiring');
    expect(d.reason).toMatch(/use first|reorder/i);
  });

  it('flags a lot expiring after "now" but before season start', () => {
    const [d] = classifyStockCarry([lot({ expiresAtMs: Date.UTC(2026, 1, 1) })], NOW, SEASON_START);
    expect(d.disposition).toBe('flag-expiring');
  });

  it('respects a custom flag window', () => {
    const decisions = classifyStockCarry(
      [lot({ expiresAtMs: SEASON_START + 60 * DAY })],
      NOW,
      SEASON_START,
      90
    );
    expect(decisions[0].disposition).toBe('flag-expiring');
  });

  it('skips zero and negative balance lots', () => {
    const out = classifyStockCarry(
      [lot({ balance: 0 }), lot({ lotId: 'l2', balance: -1 }), lot({ lotId: 'l3', balance: 1 })],
      NOW,
      SEASON_START
    );
    expect(out).toHaveLength(1);
    expect(out[0].lotId).toBe('l3');
  });
});

// ─── 3. Planting-template clone ────────────────────────────────────────────

describe('shiftOneYear', () => {
  it('preserves month/day one year forward', () => {
    const shifted = shiftOneYear(Date.UTC(2025, 4, 15, 12, 0, 0));
    expect(shifted).toBe(Date.UTC(2026, 4, 15, 12, 0, 0));
  });
});

describe('clonePlantings', () => {
  function cand(over: Partial<PlantingCloneCandidate> = {}): PlantingCloneCandidate {
    return {
      blockId: 'b1',
      cropPluginId: 'sweet-corn-ambrosia',
      varietyDisplayName: 'Ambrosia',
      cropFamily: 'corn',
      archetype: 'row-grain.pollination',
      plantingDateMs: Date.UTC(2025, 4, 15),
      status: 'harvested',
      ...over
    };
  }

  const window: ScheduleWindowLite = {
    blockId: 'b1',
    cropPluginId: 'sweet-corn-ambrosia',
    earliestMs: Date.UTC(2026, 3, 1),
    latestMs: Date.UTC(2026, 6, 1)
  };

  it('shifts a date +1 year when inside the window and tags fallback', () => {
    const [c] = clonePlantings([cand()], [window]);
    expect(c.plantingDateMs).toBe(Date.UTC(2026, 4, 15));
    expect(c.sourceProvenance).toBe('fallback');
    expect(c.dateProvenance).toBe('shifted-plus-one-year');
    expect(c.clamped).toBe(false);
  });

  it('clamps a shifted date up to earliest when it precedes the window', () => {
    // source Feb 1 → shifted Feb 1 2026 < Apr 1 earliest
    const [c] = clonePlantings([cand({ plantingDateMs: Date.UTC(2025, 1, 1) })], [window]);
    expect(c.plantingDateMs).toBe(window.earliestMs);
    expect(c.clamped).toBe(true);
    expect(c.dateProvenance).toBe('clamped-to-window');
  });

  it('clamps a shifted date down to latest when it exceeds the window', () => {
    // source Sep 1 → shifted Sep 1 2026 > Jul 1 latest
    const [c] = clonePlantings([cand({ plantingDateMs: Date.UTC(2025, 8, 1) })], [window]);
    expect(c.plantingDateMs).toBe(window.latestMs);
    expect(c.clamped).toBe(true);
  });

  it('shifts without clamping when no matching window is present', () => {
    const [c] = clonePlantings([cand()], []);
    expect(c.plantingDateMs).toBe(Date.UTC(2026, 4, 15));
    expect(c.clamped).toBe(false);
    expect(c.dateProvenance).toBe('shifted-plus-one-year');
  });

  it('clones an undated planning with a null date', () => {
    const [c] = clonePlantings([cand({ plantingDateMs: null, status: 'active' })], [window]);
    expect(c.plantingDateMs).toBeNull();
    expect(c.dateProvenance).toBe('no-source-date');
    expect(c.sourceProvenance).toBe('fallback');
  });

  it('skips failed and archived plantings', () => {
    const out = clonePlantings(
      [cand({ status: 'failed' }), cand({ status: 'archived' }), cand({ status: 'active' })],
      [window]
    );
    expect(out).toHaveLength(1);
    // Only the active planting survives; ClonedPlanting intentionally drops
    // the source `status` field.
    expect(out[0].varietyDisplayName).toBe('Ambrosia');
  });

  it('preserves quantity + unit', () => {
    const [c] = clonePlantings([cand({ quantityPlanted: 3.5, quantityUnit: 'lb' })], [window]);
    expect(c.quantityPlanted).toBe(3.5);
    expect(c.quantityUnit).toBe('lb');
  });
});

// ─── 4. Calibration hand-off ───────────────────────────────────────────────

describe('buildCalibrationHandoff', () => {
  const STALE_BEFORE = Date.UTC(2025, 0, 1);

  function sprayer(over: Partial<SprayerCalibrationSnapshot> = {}): SprayerCalibrationSnapshot {
    return {
      sprayerId: 's1',
      name: 'Boom 300',
      calibratedGpa: 15,
      calibrationDateMs: Date.UTC(2025, 5, 1),
      winterizedAtMs: null,
      ...over
    };
  }

  it('flags a winterized (null-calibration) sprayer as winterized', () => {
    const [h] = buildCalibrationHandoff(
      [
        sprayer({
          calibratedGpa: null,
          calibrationDateMs: null,
          winterizedAtMs: Date.UTC(2025, 10, 1)
        })
      ],
      STALE_BEFORE
    );
    expect(h.needsRecalibration).toBe(true);
    expect(h.reason).toBe('winterized');
  });

  it('flags a never-calibrated sprayer as uncalibrated', () => {
    const [h] = buildCalibrationHandoff(
      [sprayer({ calibratedGpa: null, calibrationDateMs: null })],
      STALE_BEFORE
    );
    expect(h.reason).toBe('uncalibrated');
  });

  it('flags a stale calibration', () => {
    const [h] = buildCalibrationHandoff(
      [sprayer({ calibrationDateMs: Date.UTC(2024, 5, 1) })],
      STALE_BEFORE
    );
    expect(h.needsRecalibration).toBe(true);
    expect(h.reason).toBe('stale');
  });

  it('passes a current, recently-calibrated sprayer', () => {
    const [h] = buildCalibrationHandoff([sprayer()], STALE_BEFORE);
    expect(h.needsRecalibration).toBe(false);
    expect(h.reason).toBe('current');
  });
});

// ─── 5. N-credit re-key ────────────────────────────────────────────────────

describe('nCreditFromTerminatedCovers', () => {
  function cover(over: Partial<TerminatedCoverSnapshot> = {}): TerminatedCoverSnapshot {
    return {
      blockId: 'b1',
      cropPluginId: 'crimson-clover-cover',
      nCreditLbPerAcre: 70,
      archetype: 'cover-crop.termination',
      status: 'harvested',
      ...over
    };
  }

  it('credits a terminated cover crop to its block', () => {
    const [c] = nCreditFromTerminatedCovers([cover()]);
    expect(c.blockId).toBe('b1');
    expect(c.nCreditLbPerAcre).toBe(70);
    expect(c.sourcePluginIds).toEqual(['crimson-clover-cover']);
  });

  it('sums multiple cover crops on one block', () => {
    const [c] = nCreditFromTerminatedCovers([
      cover(),
      cover({ cropPluginId: 'daikon-radish-cover', nCreditLbPerAcre: 30 })
    ]);
    expect(c.nCreditLbPerAcre).toBe(100);
    expect(c.sourcePluginIds).toEqual(['crimson-clover-cover', 'daikon-radish-cover']);
  });

  it('treats an unknown cover-crop credit (null) as 0', () => {
    const [c] = nCreditFromTerminatedCovers([cover({ nCreditLbPerAcre: null })]);
    expect(c.nCreditLbPerAcre).toBe(0);
  });

  it('ignores non-cover-crop plantings (the #228 real fix — actual terminations only)', () => {
    const out = nCreditFromTerminatedCovers([
      cover({ archetype: 'row-grain.pollination', cropPluginId: 'sweet-corn' })
    ]);
    expect(out).toEqual([]);
  });

  it('ignores cover crops that were not terminated (planned only)', () => {
    const out = nCreditFromTerminatedCovers([cover({ status: 'planned' })]);
    expect(out).toEqual([]);
  });

  it('keys credits per block and sorts by blockId', () => {
    const out = nCreditFromTerminatedCovers([cover({ blockId: 'b2' }), cover({ blockId: 'b1' })]);
    expect(out.map((c) => c.blockId)).toEqual(['b1', 'b2']);
  });
});

// ─── Aggregate summary ─────────────────────────────────────────────────────

describe('summarizeCarryForward', () => {
  it('rolls up counts across all five deliverables', () => {
    const input: Omit<CarryForwardSeasonResult, 'summary'> = {
      fromYear: 2025,
      toYear: 2026,
      rotation: [
        {
          blockId: 'b1',
          blockName: 'N',
          severity: 'warn',
          priorFamilies: ['brassica'],
          message: '',
          avoidFamilies: ['brassica']
        },
        {
          blockId: 'b2',
          blockName: 'S',
          severity: 'ok',
          priorFamilies: [],
          message: '',
          avoidFamilies: []
        }
      ],
      stock: [
        {
          lotId: 'l1',
          stockItemId: 'i1',
          displayName: '',
          category: 'herbicide',
          balance: 1,
          unit: 'gal',
          expiresAtMs: null,
          disposition: 'roll',
          reason: ''
        },
        {
          lotId: 'l2',
          stockItemId: 'i2',
          displayName: '',
          category: 'seed',
          balance: 1,
          unit: 'lb',
          expiresAtMs: 1,
          disposition: 'flag-expiring',
          reason: ''
        },
        {
          lotId: 'l3',
          stockItemId: 'i3',
          displayName: '',
          category: 'fungicide',
          balance: 1,
          unit: 'gal',
          expiresAtMs: 1,
          disposition: 'expired',
          reason: ''
        }
      ],
      clonedPlantings: [
        {
          blockId: 'b1',
          cropPluginId: 'x',
          varietyDisplayName: 'X',
          cropFamily: 'corn',
          archetype: 'row-grain.pollination',
          plantingDateMs: 1,
          sourceProvenance: 'fallback',
          dateProvenance: 'shifted-plus-one-year',
          clamped: false
        }
      ],
      calibration: [
        { sprayerId: 's1', name: 'A', needsRecalibration: true, reason: 'winterized' },
        { sprayerId: 's2', name: 'B', needsRecalibration: false, reason: 'current' }
      ],
      nCredits: [
        { blockId: 'b1', nCreditLbPerAcre: 70, sourcePluginIds: ['crimson-clover-cover'] },
        { blockId: 'b2', nCreditLbPerAcre: 0, sourcePluginIds: [] }
      ]
    };
    const r = summarizeCarryForward(input);
    expect(r.summary).toEqual({
      blocksWithRotationWarnings: 1,
      lotsRolled: 1,
      lotsFlagged: 1,
      lotsExpired: 1,
      plantingsCloned: 1,
      sprayersNeedingRecalibration: 1,
      blocksWithNCredit: 1
    });
  });
});

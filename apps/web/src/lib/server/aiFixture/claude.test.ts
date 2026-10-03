// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { CropPlugin } from '$lib/plugins/schemas';
import type { BlockWithPlantings } from '$lib/db/blocks';
import type { PlanInput } from '$lib/layout/engine';
import {
  allocate,
  buildAllocationPrompt,
  buildCandidacyMatrix,
  refineAllocation,
  validateAiPlan
} from '../aiAllocation';
import type { FarmContext } from '../aiPlanning';
import {
  claudeFixtureEnabled,
  createFixtureClient,
  E2E_FIXTURE_API_KEY,
  FIXTURE_REFINE_INVALID,
  FIXTURE_REFINE_VALID,
  fixtureAllocationPlan,
  fixtureAnswerText,
  fixtureMessage,
  FixtureNoAnswerError,
  parseAllocationPrompt
} from './claude';

function plugin(pluginId: string, cropFamily: string, spacing: number): CropPlugin {
  return {
    pluginId,
    type: 'crop',
    displayName: pluginId,
    version: '1.0.0',
    cropFamily,
    defaultRowSpacingInches: spacing,
    plantingGuide: {
      rowSpacingIn: spacing,
      inRowSpacingIn: { min: spacing / 2, max: spacing / 2 }
    },
    daysToMaturity: { min: 60, max: 90 }
  } as CropPlugin;
}

function block(id: string, acres: number): BlockWithPlantings {
  return {
    id,
    name: `Bed ${id}`,
    acres,
    tillageMethod: 'conventional',
    axesLocked: false,
    sunExposure: 'full',
    plantings: []
  };
}

function input(seedCount = 3): PlanInput {
  const crops = {
    bean: plugin('bean', 'legume', 18),
    beet: plugin('beet', 'root', 12),
    lettuce: plugin('lettuce', 'leafy-green', 12)
  };
  const ids = ['bean', 'beet', 'lettuce'] as const;
  return {
    seeds: ids.slice(0, seedCount).map((id, i) => ({
      stockItemId: `stock-${id}`,
      cropPluginId: id,
      varietyDisplayName: id,
      quantityPlants: 200 + i * 100
    })),
    blocks: [block('north', 0.02), block('south', 0.02)],
    axes: [
      { blockId: 'north', east: 0, north: 0 },
      { blockId: 'south', east: 1, north: 0 }
    ],
    existingCrops: [],
    pluginIndex: crops,
    companions: {}
  };
}

const ctx: FarmContext = {
  latLon: { lat: 39.1, lon: -77.6 },
  lastFrostMs: Date.UTC(2026, 3, 20),
  firstFrostMs: Date.UTC(2026, 9, 15),
  blocks: [],
  cropCatalog: []
};

function promptFor(i: PlanInput): {
  prompt: string;
  matrix: ReturnType<typeof buildCandidacyMatrix>;
} {
  const matrix = buildCandidacyMatrix(i);
  return { prompt: buildAllocationPrompt(matrix, i), matrix };
}

describe('claudeFixtureEnabled', () => {
  it('is on only when both variables are exactly "1"', () => {
    expect(claudeFixtureEnabled({ E2E_CLAUDE_FIXTURE: '1', ENABLE_DEV_ROUTES: '1' })).toBe(true);
    for (const env of [
      {},
      { E2E_CLAUDE_FIXTURE: '1' },
      { ENABLE_DEV_ROUTES: '1' },
      { E2E_CLAUDE_FIXTURE: 'true', ENABLE_DEV_ROUTES: '1' },
      { E2E_CLAUDE_FIXTURE: '1', ENABLE_DEV_ROUTES: 'yes' },
      { E2E_CLAUDE_FIXTURE: '0', ENABLE_DEV_ROUTES: '0' }
    ]) {
      expect(claudeFixtureEnabled(env)).toBe(false);
    }
  });
});

describe('parseAllocationPrompt', () => {
  it('reads seeds, blocks and every matrix row from the real prompt', () => {
    const i = input();
    const { prompt, matrix } = promptFor(i);
    const parsed = parseAllocationPrompt(prompt);
    expect(parsed.seeds.map((s) => s.stockItemId)).toEqual(i.seeds.map((s) => s.stockItemId));
    expect(parsed.seeds.map((s) => s.available)).toEqual(i.seeds.map((s) => s.quantityPlants));
    expect(parsed.blockIds).toEqual(['north', 'south']);
    expect(parsed.rows).toHaveLength(matrix.length);
    for (const r of matrix) {
      const p = parsed.rows.find((x) => x.stockItemId === r.stockItemId && x.blockId === r.blockId);
      expect(p?.plantsFit).toBe(r.plantsFit);
      expect(p?.plantsAvailable).toBe(r.plantsAvailable);
    }
  });

  it('reads the cap of a fill-to-bed seed as its available plants', () => {
    const base = input(1);
    const i: PlanInput = { ...base, seeds: [{ ...base.seeds[0], fillToCapacity: true }] };
    const parsed = parseAllocationPrompt(promptFor(i).prompt);
    expect(parsed.seeds[0].available).toBe(200);
  });
});

describe('fixture answers', () => {
  it('gives an allocation the real validator accepts, seed i on block i mod n', () => {
    for (const n of [1, 2, 3]) {
      const i = input(n);
      const { prompt, matrix } = promptFor(i);
      const plan = fixtureAllocationPlan(prompt);
      expect(plan.assignments.map((a) => a.blockId)).toEqual(
        ['north', 'south', 'north'].slice(0, n)
      );
      expect(validateAiPlan(plan, i, matrix).valid).toBe(true);
    }
  });

  it('halves the first seed for the valid refine phrase and breaks plantsFit for the invalid one', () => {
    const i = input(2);
    const { prompt, matrix } = promptFor(i);
    const prior = fixtureAllocationPlan(prompt);
    const messages = (farmer: string) => [
      { role: 'user' as const, content: [{ type: 'text', text: prompt }] },
      { role: 'assistant' as const, content: [{ type: 'text', text: JSON.stringify(prior) }] },
      { role: 'user' as const, content: `REFINEMENT TURN\n\nFarmer's message: ${farmer}` }
    ];
    const valid = JSON.parse(
      fixtureAnswerText({ model: 'm', messages: messages(FIXTURE_REFINE_VALID) })
    );
    expect(valid.assignments[0].plants).toBe(Math.floor(prior.assignments[0].plants / 2));
    expect(valid.assignments[1].plants).toBe(prior.assignments[1].plants);
    const previousTotals = new Map<string, number>();
    for (const a of prior.assignments as Array<{ stockItemId: string; plants: number }>) {
      previousTotals.set(a.stockItemId, (previousTotals.get(a.stockItemId) ?? 0) + a.plants);
    }
    expect(validateAiPlan(valid, i, matrix, { previousTotals }).valid).toBe(true);

    const bad = JSON.parse(
      fixtureAnswerText({ model: 'm', messages: messages(FIXTURE_REFINE_INVALID) })
    );
    const fit = matrix.find(
      (r) =>
        r.stockItemId === prior.assignments[0].stockItemId &&
        r.blockId === prior.assignments[0].blockId
    )!.plantsFit;
    expect(bad.assignments[0].plants).toBe(Math.max(fit + 1, Math.ceil(fit * 1.5)));
    expect(validateAiPlan(bad, i, matrix).valid).toBe(false);

    const retry = [
      ...messages(FIXTURE_REFINE_INVALID),
      { role: 'assistant' as const, content: JSON.stringify(bad) },
      { role: 'user' as const, content: 'Your previous response was rejected by the validator.' }
    ];
    expect(JSON.parse(fixtureAnswerText({ model: 'm', messages: retry }))).toEqual(bad);
  });

  it('throws FixtureNoAnswerError for anything else', () => {
    expect(() =>
      fixtureAnswerText({
        model: 'm',
        messages: [{ role: 'user', content: 'Schedule these plantings' }]
      })
    ).toThrow(FixtureNoAnswerError);
    const { prompt } = promptFor(input(1));
    expect(() =>
      fixtureAnswerText({
        model: 'm',
        messages: [
          { role: 'user', content: prompt },
          { role: 'assistant', content: '{"assignments":[]}' },
          { role: 'user', content: "Farmer's message: move the beans" }
        ]
      })
    ).toThrow(FixtureNoAnswerError);
    expect(() => createFixtureClient().messages.stream()).toThrow(FixtureNoAnswerError);
  });

  it('answers in the Messages API shape with usage filled in', () => {
    const { prompt } = promptFor(input(1));
    const msg = fixtureMessage({
      model: 'claude-sonnet-x',
      system: [{ type: 'text', text: 'farm header' }],
      messages: [{ role: 'user', content: prompt }]
    });
    expect(msg).toMatchObject({
      type: 'message',
      role: 'assistant',
      model: 'claude-sonnet-x',
      stop_reason: 'end_turn',
      content: [{ type: 'text' }]
    });
    expect(msg.id).toMatch(/^msg_e2e_fixture_\d+$/);
    expect(msg.usage.input_tokens).toBeGreaterThan(0);
    expect(msg.usage.output_tokens).toBeGreaterThan(0);
    expect(msg.usage.cache_read_input_tokens).toBeGreaterThan(0);
  });
});

describe('the fixture below the real allocation code', () => {
  const saved: Record<string, string | undefined> = {};
  const vars = ['E2E_CLAUDE_FIXTURE', 'ENABLE_DEV_ROUTES', 'ANTHROPIC_API_KEY'] as const;
  beforeEach(() => {
    for (const v of vars) saved[v] = process.env[v];
    process.env.E2E_CLAUDE_FIXTURE = '1';
    process.env.ENABLE_DEV_ROUTES = '1';
    process.env.ANTHROPIC_API_KEY = E2E_FIXTURE_API_KEY;
  });
  afterEach(() => {
    for (const v of vars) {
      if (saved[v] === undefined) delete process.env[v];
      else process.env[v] = saved[v];
    }
  });

  it('allocate returns the fixture plan as an AI plan with a cost', async () => {
    const result = await allocate(input(2), ctx);
    expect(result.meta.fallback).toBeUndefined();
    expect(result.assignments).toHaveLength(2);
    expect(result.meta.usdEstimate).toBeGreaterThan(0);
  });

  it('refine applies the valid phrase and offers the rejected plan for the invalid one', async () => {
    const i = input(2);
    const first = await allocate(i, ctx);
    const previousAssignments = first.assignments.map((a) => ({
      stockItemId: a.stockItemId,
      blockId: a.blockId,
      plants: a.plants,
      rationale: ''
    }));
    const base = { previousAssignments, previousRationale: '', previousAdvisories: [] };

    const ok = await refineAllocation(i, ctx, {
      ...base,
      transcript: [{ role: 'user', content: FIXTURE_REFINE_VALID }]
    });
    expect(ok.meta.fallback).toBeUndefined();
    expect(ok.assignments[0].plants).toBe(Math.floor(first.assignments[0].plants / 2));

    const bad = await refineAllocation(i, ctx, {
      ...base,
      transcript: [{ role: 'user', content: FIXTURE_REFINE_INVALID }]
    });
    expect(bad.meta.fallback).toBe('engine-only');
    expect(bad.assignments).toEqual(first.assignments.map((a) => ({ ...a, score: 0 })));
    expect(bad.meta.rejectedAssignments?.[0].plants).toBeGreaterThan(first.assignments[0].plants);
    expect(bad.meta.violationsOnFirstAttempt?.length).toBeGreaterThan(0);
  });
});

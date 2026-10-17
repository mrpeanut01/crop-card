/**
 * TEST ONLY. A stand-in for the Anthropic client on the e2e preview server,
 * so Playwright can drive the AllocationWizard's AI paths without a key.
 *
 * It answers only when the server runs with E2E_CLAUDE_FIXTURE=1 and
 * ENABLE_DEV_ROUTES=1 (production sets neither, see the unit tests) and the
 * farm's saved key is the sentinel E2E_FIXTURE_API_KEY. It sits below
 * aiTry(): key resolution, the guard, budgets, daily caps, call logging and
 * provenance all run exactly as they do with a real key.
 *
 * The answers are canned. Ids and numbers come from the request, so they are
 * valid for any farm. The text is placeholder wording and holds no farm
 * advice. Any request it does not recognise throws FixtureNoAnswerError at
 * once, which the callers already turn into their deterministic fallback.
 *
 * Requests are routed through `FIXTURE_ENTRIES` (R-24): allocation here, and
 * one module per Phase 37 cluster (`gardenBrief.ts`, `photoMarks.ts`) keyed
 * on a `CROPCARD_FIXTURE:<name>` marker in the prompt.
 */

import {
  E2E_FIXTURE_API_KEY,
  FIXTURE_REFINE_INVALID,
  FIXTURE_REFINE_VALID
} from '$lib/aiFixturePhrases';
import {
  type CreateParams,
  type FixtureEntry,
  FixtureNoAnswerError,
  type FixtureMessage,
  textOf
} from './types';
import { gardenBriefFixture } from './gardenBrief';
import { photoMarksFixture } from './photoMarks';

export { E2E_FIXTURE_API_KEY, FIXTURE_REFINE_INVALID, FIXTURE_REFINE_VALID };

/** True only on a dev-routes server that asked for the fixture. Read at call
 *  time so tests can flip the variables. */
export function claudeFixtureEnabled(env: Record<string, string | undefined>): boolean {
  return env.E2E_CLAUDE_FIXTURE === '1' && env.ENABLE_DEV_ROUTES === '1';
}

export { FixtureNoAnswerError, type FixtureMessage };

const MATRIX_MARKER = 'CANDIDACY MATRIX';
const ALLOCATE_LEAD = 'Allocate the following seed lots';
const FARMER_MARKER = "Farmer's message: ";

export interface FixtureMatrixRow {
  stockItemId: string;
  blockId: string;
  plantsFit: number;
  plantsAvailable: number;
  compBad: boolean;
}

export interface ParsedAllocationPrompt {
  seeds: Array<{ stockItemId: string; available: number }>;
  blockIds: string[];
  rows: FixtureMatrixRow[];
}

/** Reads the SEEDS, BLOCKS and CANDIDACY MATRIX sections of the allocation
 *  prompt built by `buildAllocationPrompt`. */
export function parseAllocationPrompt(prompt: string): ParsedAllocationPrompt {
  const lines = prompt.split('\n');
  const seeds: ParsedAllocationPrompt['seeds'] = [];
  const blockIds: string[] = [];
  const rows: FixtureMatrixRow[] = [];
  let section: 'none' | 'seeds' | 'blocks' | 'matrix-header' | 'matrix' = 'none';
  for (const line of lines) {
    if (line === 'SEEDS:') {
      section = 'seeds';
      continue;
    }
    if (line === 'BLOCKS:') {
      section = 'blocks';
      continue;
    }
    if (line.startsWith(MATRIX_MARKER)) {
      section = 'matrix-header';
      continue;
    }
    if (line.trim() === '') {
      if (section !== 'matrix-header') section = 'none';
      continue;
    }
    if (section === 'seeds' && line.startsWith('- ')) {
      const parts = line.slice(2).split(' | ');
      const id = parts[0]?.trim();
      const avail = line.match(/available_plants=(\d+)/) ?? line.match(/at most (\d+)/);
      if (id) seeds.push({ stockItemId: id, available: avail ? Number(avail[1]) : 0 });
    } else if (section === 'blocks' && line.startsWith('- ')) {
      const id = line.slice(2).split(' | ')[0]?.trim();
      if (id) blockIds.push(id);
    } else if (section === 'matrix-header') {
      section = 'matrix';
    } else if (section === 'matrix') {
      const cols = line.split(',');
      if (cols.length < 12) {
        section = 'none';
        continue;
      }
      rows.push({
        stockItemId: cols[0],
        blockId: cols[1],
        plantsFit: Number(cols[2]) || 0,
        plantsAvailable: Number(cols[3]) || 0,
        compBad: cols[9] !== '-'
      });
    }
  }
  return { seeds, blockIds, rows };
}

interface PlanJson {
  rationale: string;
  assignments: Array<{ stockItemId: string; blockId: string; plants: number; rationale: string }>;
  advisories: string[];
}

/** Seed i goes on block i mod n (or the next block that has a usable matrix
 *  row), with plants = min(available, plantsFit shared evenly between the
 *  seeds on that block), so the plan passes every validator cap. */
export function fixtureAllocationPlan(prompt: string): PlanJson {
  const { seeds, blockIds, rows } = parseAllocationPrompt(prompt);
  if (seeds.length === 0 || blockIds.length === 0 || rows.length === 0) {
    throw new FixtureNoAnswerError('allocation prompt');
  }
  const rowFor = (s: string, b: string) => rows.find((r) => r.stockItemId === s && r.blockId === b);
  const picks: Array<{ stockItemId: string; available: number; row: FixtureMatrixRow }> = [];
  seeds.forEach((seed, i) => {
    for (let k = 0; k < blockIds.length; k++) {
      const row = rowFor(seed.stockItemId, blockIds[(i + k) % blockIds.length]);
      if (row && !row.compBad && row.plantsFit > 0) {
        picks.push({ stockItemId: seed.stockItemId, available: seed.available, row });
        return;
      }
    }
  });
  const perBlock = new Map<string, number>();
  for (const p of picks) perBlock.set(p.row.blockId, (perBlock.get(p.row.blockId) ?? 0) + 1);
  const assignments: PlanJson['assignments'] = [];
  for (const p of picks) {
    const share = Math.floor(p.row.plantsFit / (perBlock.get(p.row.blockId) ?? 1));
    const plants = Math.min(p.available > 0 ? p.available : share, share);
    if (plants < 1) continue;
    assignments.push({
      stockItemId: p.stockItemId,
      blockId: p.row.blockId,
      plants,
      rationale: 'Test fixture placement.'
    });
  }
  return {
    rationale: 'Test fixture plan. Each seed lot is placed in order on the picked blocks.',
    assignments,
    advisories: []
  };
}

function parsePreviousPlan(text: string): PlanJson {
  try {
    const raw = JSON.parse(text) as Partial<PlanJson>;
    if (Array.isArray(raw.assignments)) {
      return {
        rationale: typeof raw.rationale === 'string' ? raw.rationale : '',
        assignments: raw.assignments,
        advisories: Array.isArray(raw.advisories) ? raw.advisories : []
      };
    }
  } catch {
    // fall through
  }
  throw new FixtureNoAnswerError('refine turn');
}

/** The refine answer for one of the two trigger phrases. Every prior pair is
 *  kept (refinement is substitution only). */
export function fixtureRefinement(
  farmerMessage: string,
  matrixPrompt: string,
  previousPlanText: string
): PlanJson & { reply: string } {
  const previous = parsePreviousPlan(previousPlanText);
  if (previous.assignments.length === 0) throw new FixtureNoAnswerError('refine turn');
  const first = previous.assignments[0];
  if (farmerMessage === FIXTURE_REFINE_VALID) {
    return {
      reply: 'Test fixture reply. The first seed lot now has half as many plants.',
      rationale: previous.rationale,
      assignments: previous.assignments.map((a) => ({
        ...a,
        plants:
          a.stockItemId === first.stockItemId ? Math.max(1, Math.floor(a.plants / 2)) : a.plants
      })),
      advisories: []
    };
  }
  if (farmerMessage === FIXTURE_REFINE_INVALID) {
    const { rows } = parseAllocationPrompt(matrixPrompt);
    const row = rows.find(
      (r) => r.stockItemId === first.stockItemId && r.blockId === first.blockId
    );
    const fit = row?.plantsFit ?? first.plants;
    const over = Math.max(fit + 1, Math.ceil(fit * 1.5));
    return {
      reply: 'Test fixture reply. The first bed now holds as many plants as asked.',
      rationale: 'Test fixture plan that packs the first bed past its room.',
      assignments: previous.assignments.map((a, i) => (i === 0 ? { ...a, plants: over } : a)),
      advisories: []
    };
  }
  throw new FixtureNoAnswerError('refine message');
}

function lastFarmerTurn(turns: Array<{ role: string; text: string }>): number {
  for (let i = turns.length - 1; i >= 0; i--) {
    if (turns[i].role === 'user' && turns[i].text.includes(FARMER_MARKER)) return i;
  }
  return -1;
}

function turnsOf(params: CreateParams) {
  return params.messages.map((m) => ({ role: m.role, text: textOf(m.content) }));
}

function isAllocationLead(t: { role: string; text: string }): boolean {
  return t.role === 'user' && t.text.startsWith(ALLOCATE_LEAD) && t.text.includes(MATRIX_MARKER);
}

/** The allocation wizard's allocate and refine turns. */
export const allocationFixture: FixtureEntry = {
  name: 'allocation',
  matches(params) {
    const turns = turnsOf(params);
    return lastFarmerTurn(turns) >= 0 || turns.some(isAllocationLead);
  },
  answer(params) {
    const turns = turnsOf(params);
    const refineIdx = lastFarmerTurn(turns);
    if (refineIdx >= 0) {
      const t = turns[refineIdx].text;
      const farmer = t.slice(t.lastIndexOf(FARMER_MARKER) + FARMER_MARKER.length).trim();
      let matrixIdx = -1;
      for (let i = refineIdx - 1; i >= 0; i--) {
        if (turns[i].role === 'user' && turns[i].text.includes(MATRIX_MARKER)) {
          matrixIdx = i;
          break;
        }
      }
      const prev = turns[matrixIdx + 1];
      if (matrixIdx < 0 || !prev || prev.role !== 'assistant') {
        throw new FixtureNoAnswerError('refine turn');
      }
      return JSON.stringify(fixtureRefinement(farmer, turns[matrixIdx].text, prev.text));
    }
    for (let i = turns.length - 1; i >= 0; i--) {
      if (isAllocationLead(turns[i])) return JSON.stringify(fixtureAllocationPlan(turns[i].text));
    }
    throw new FixtureNoAnswerError();
  }
};

/** Checked in order; the first entry whose `matches` is true answers. */
export const FIXTURE_ENTRIES: readonly FixtureEntry[] = [
  allocationFixture,
  gardenBriefFixture,
  photoMarksFixture
];

/** The first matching entry's answer, or FixtureNoAnswerError. */
export function dispatchFixture(
  params: CreateParams,
  entries: readonly FixtureEntry[] = FIXTURE_ENTRIES
): string | FixtureMessage {
  const entry = entries.find((e) => e.matches(params));
  if (!entry) throw new FixtureNoAnswerError();
  return entry.answer(params);
}

/** Picks the canned answer for a Messages API request, or throws. */
export function fixtureAnswerText(
  params: CreateParams,
  entries: readonly FixtureEntry[] = FIXTURE_ENTRIES
): string {
  const answer = dispatchFixture(params, entries);
  if (typeof answer === 'string') return answer;
  return answer.content.map((b) => b.text).join('');
}

const tokens = (s: string) => Math.max(1, Math.ceil(s.length / 4));

let messageSeq = 0;

/** A Messages API response with the same shape a real key returns. */
export function fixtureMessage(
  params: CreateParams,
  entries: readonly FixtureEntry[] = FIXTURE_ENTRIES
): FixtureMessage {
  const answer = dispatchFixture(params, entries);
  if (typeof answer !== 'string') return answer;
  const text = answer;
  const prompt = params.messages.map((m) => textOf(m.content)).join('\n');
  messageSeq += 1;
  return {
    id: `msg_e2e_fixture_${String(messageSeq).padStart(6, '0')}`,
    type: 'message',
    role: 'assistant',
    model: params.model,
    content: [{ type: 'text', text, citations: null }],
    stop_reason: 'end_turn',
    stop_sequence: null,
    usage: {
      input_tokens: tokens(prompt),
      output_tokens: tokens(text),
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: tokens(textOf(params.system))
    }
  };
}

/** The object `anthropicClient()` hands back for a fixture farm. Only the
 *  surface the server modules call is present. */
export function createFixtureClient() {
  return {
    messages: {
      async create(params: CreateParams): Promise<FixtureMessage> {
        return fixtureMessage(params);
      },
      stream(): never {
        throw new FixtureNoAnswerError('streamed request');
      }
    }
  };
}

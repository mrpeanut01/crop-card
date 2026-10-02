import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  BOUGHT_FEED_NOTE,
  MAX_PATHS,
  NO_SOURCES_NOTE,
  SUPPLIER_SAID_NONE_NOTE,
  combineStates,
  computeChains,
  exposureReaches,
  factsHash,
  needsSupplierAdvice,
  pathSentence,
  stateLabel,
  type ChainApplication,
  type ChainBatch,
  type ChainFacts,
  type ChainInput,
  type ChainSource,
  type CarryoverState
} from './carryover';
import { AMENDMENT_BATCH_KINDS, AMENDMENT_INPUT_TYPES, SUPPLIER_STATEMENTS } from '$lib/db/schema';
import { BATCH_KINDS, INPUT_TYPES, SUPPLIER_STATEMENT_VALUES } from './model';

const DAY = 86_400_000;
const T0 = Date.UTC(2026, 4, 1, 12);
const at = (d: number) => T0 + d * DAY;
const TZ = 'America/New_York';

const goats = { type: 'group' as const, id: 'g-goats', name: 'Goats' };

function batch(over: Partial<ChainBatch> & { id: string }): ChainBatch {
  return {
    name: over.id,
    origin: 'on-farm',
    supplier: null,
    supplierStatement: null,
    startedAtMs: at(0),
    closedAtMs: null,
    ...over
  };
}

function input(over: Partial<ChainInput> & { id: string; batchId: string }): ChainInput {
  return {
    inputType: 'group',
    inputId: goats.id,
    fromMs: at(10),
    toMs: at(20),
    supplierStatement: null,
    ...over
  };
}

function app(over: Partial<ChainApplication> = {}): ChainApplication {
  return {
    ref: 'spray:s1',
    blockId: 'b-pasture',
    fieldId: 'f-pasture',
    appliedAtMs: at(0),
    productName: 'GrazonNext HL',
    productPluginId: 'grazonnext-hl',
    manureCarryoverDays: 3,
    unknownProduct: false,
    ...over
  };
}

function facts(over: Partial<ChainFacts> = {}): ChainFacts {
  return {
    batches: [],
    inputs: [],
    sources: new Map(),
    feedUses: [],
    lots: new Map(),
    cuttings: new Map(),
    applications: [],
    fieldNames: new Map([['f-pasture', 'North pasture']]),
    nowMs: at(100),
    ...over
  };
}

function grazed(fromDay: number, toDay: number | null): ChainSource {
  return {
    stays: [
      {
        subject: goats,
        fieldId: 'f-pasture',
        fromMs: at(fromDay),
        toMs: toDay === null ? null : at(toDay)
      }
    ],
    feedReach: [{ subject: goats, fromMs: null, toMs: null }]
  };
}

function stateOf(f: ChainFacts, id = 'pile'): CarryoverState {
  return computeChains(f).get(id)!.state;
}

describe('enums', () => {
  it('match the schema', () => {
    expect([...BATCH_KINDS]).toEqual([...AMENDMENT_BATCH_KINDS]);
    expect([...INPUT_TYPES]).toEqual([...AMENDMENT_INPUT_TYPES]);
    expect([...SUPPLIER_STATEMENT_VALUES]).toEqual([...SUPPLIER_STATEMENTS]);
  });
});

describe('exposureReaches (M-29)', () => {
  const w = { startMs: at(10), endMs: at(20) };
  it('needs the exposure to start by the window end', () => {
    expect(exposureReaches({ startMs: at(21), endMs: at(22) }, w, 3)).toBe(false);
    expect(exposureReaches({ startMs: at(20), endMs: at(22) }, w, 3)).toBe(true);
  });
  it('reaches the window start through the carryover days, both edges', () => {
    expect(exposureReaches({ startMs: at(1), endMs: at(7) }, w, 3)).toBe(true);
    expect(exposureReaches({ startMs: at(1), endMs: at(7) - 1 }, w, 3)).toBe(false);
  });
  it('unknown days run to the window end (M-04)', () => {
    expect(exposureReaches({ startMs: at(-900), endMs: at(-899) }, w, null)).toBe(true);
  });
});

describe('computeChains', () => {
  const pile = batch({ id: 'pile', name: 'Goat pile' });

  it('animal grazing a treated pasture inside the window is may-carry', () => {
    const f = facts({
      batches: [pile],
      inputs: [input({ id: 'i1', batchId: 'pile' })],
      sources: new Map([['i1', grazed(5, 15)]]),
      applications: [app()]
    });
    const chain = computeChains(f).get('pile')!;
    expect(chain.state).toBe('may-carry');
    expect(chain.paths).toHaveLength(1);
    expect(pathSentence(chain.paths[0], TZ)).toBe(
      'Goats grazed North pasture from May 6, 2026 to May 16, 2026, after GrazonNext HL was sprayed there on May 1, 2026.'
    );
    expect(chain.standingNotes).toContain(BOUGHT_FEED_NOTE);
  });

  it('an input whose group is no longer on file is not known', () => {
    const f = facts({
      batches: [pile],
      inputs: [input({ id: 'i1', batchId: 'pile' })],
      sources: new Map([['i1', { stays: [], feedReach: [], missing: true }]]),
      applications: [app()]
    });
    const chain = computeChains(f).get('pile')!;
    expect(chain.state).toBe('not-known');
    expect(pathSentence(chain.paths[0], TZ)).toBe(
      'A group added to this pile is no longer on file, so where it grazed and what it ate is not known.'
    );
  });

  it('a stay long after the spray still counts, with no end (M-26)', () => {
    const f = facts({
      batches: [pile],
      inputs: [input({ id: 'i1', batchId: 'pile', fromMs: at(400), toMs: at(410) })],
      sources: new Map([['i1', grazed(398, 405)]]),
      applications: [app()],
      nowMs: at(500)
    });
    expect(stateOf(f)).toBe('may-carry');
  });

  it('grazing that ended more than the carryover days before collection is none on file', () => {
    const f = facts({
      batches: [pile],
      inputs: [input({ id: 'i1', batchId: 'pile', fromMs: at(10) })],
      sources: new Map([['i1', grazed(2, 6)]]),
      applications: [app({ manureCarryoverDays: 3 })]
    });
    const chain = computeChains(f).get('pile')!;
    expect(chain.state).toBe('none-on-file');
    expect(chain.paths).toEqual([]);
    expect(stateLabel(chain.state)).toBe(
      "No carryover weed killer on file for this batch's sources."
    );
  });

  it('an exposure ending exactly carryover days before the window counts; a moment earlier does not', () => {
    const base = {
      batches: [pile],
      inputs: [input({ id: 'i1', batchId: 'pile', fromMs: at(10) })],
      applications: [app({ manureCarryoverDays: 3 })]
    };
    const edge = facts({
      ...base,
      sources: new Map([['i1', grazed(2, 7)]])
    });
    expect(stateOf(edge)).toBe('may-carry');
    const before: ChainSource = grazed(2, 7);
    before.stays[0].toMs = at(7) - 1;
    expect(stateOf(facts({ ...base, sources: new Map([['i1', before]]) }))).toBe('none-on-file');
  });

  it('missing manureCarryoverDays counts to the end of the window', () => {
    const f = facts({
      batches: [pile],
      inputs: [input({ id: 'i1', batchId: 'pile', fromMs: at(300), toMs: at(320) })],
      sources: new Map([['i1', grazed(2, 6)]]),
      applications: [app({ manureCarryoverDays: null })]
    });
    expect(stateOf(f)).toBe('may-carry');
  });

  it('grazing that started after the window closed does not count', () => {
    const f = facts({
      batches: [pile],
      inputs: [input({ id: 'i1', batchId: 'pile' })],
      sources: new Map([['i1', grazed(30, 40)]]),
      applications: [app({ manureCarryoverDays: null })]
    });
    expect(stateOf(f)).toBe('none-on-file');
  });

  it('a spray after the animals left does not count', () => {
    const f = facts({
      batches: [pile],
      inputs: [input({ id: 'i1', batchId: 'pile' })],
      sources: new Map([['i1', grazed(1, 9)]]),
      applications: [app({ appliedAtMs: at(9) + 1 })]
    });
    expect(stateOf(f)).toBe('none-on-file');
  });

  it('a free-text herbicide is not known', () => {
    const f = facts({
      batches: [pile],
      inputs: [input({ id: 'i1', batchId: 'pile' })],
      sources: new Map([['i1', grazed(5, 15)]]),
      applications: [
        app({
          unknownProduct: true,
          productPluginId: null,
          productName: 'Brush killer',
          manureCarryoverDays: null
        })
      ]
    });
    const chain = computeChains(f).get('pile')!;
    expect(chain.state).toBe('not-known');
    expect(pathSentence(chain.paths[0], TZ)).toContain(
      'Brush killer, a weed killer not in the library,'
    );
  });

  it('compost from two manure batches, one flagged, may carry', () => {
    const f = facts({
      batches: [
        batch({ id: 'pile', name: 'Compost' }),
        batch({ id: 'm1', name: 'Goat pile' }),
        batch({ id: 'm2', name: 'Horse pile' })
      ],
      inputs: [
        input({ id: 'c1', batchId: 'pile', inputType: 'batch', inputId: 'm1', toMs: null }),
        input({ id: 'c2', batchId: 'pile', inputType: 'batch', inputId: 'm2', toMs: null }),
        input({ id: 'i1', batchId: 'm1' }),
        input({ id: 'i2', batchId: 'm2', inputId: 'g-horses' })
      ],
      sources: new Map([
        ['i1', grazed(5, 15)],
        ['i2', { stays: [], feedReach: [] }]
      ]),
      applications: [app()]
    });
    const chains = computeChains(f);
    expect(chains.get('m2')!.state).toBe('none-on-file');
    const compost = chains.get('pile')!;
    expect(compost.state).toBe('may-carry');
    expect(compost.paths[0].inputId).toBe('c1');
    expect(pathSentence(compost.paths[0], TZ)).toMatch(/^Through Goat pile: Goats grazed/);
  });

  it('a cycle between batches terminates and adds nothing', () => {
    const f = facts({
      batches: [batch({ id: 'a' }), batch({ id: 'b' })],
      inputs: [
        input({ id: 'ab', batchId: 'a', inputType: 'batch', inputId: 'b', toMs: null }),
        input({ id: 'ba', batchId: 'b', inputType: 'batch', inputId: 'a', toMs: null }),
        input({ id: 'aa', batchId: 'a', inputType: 'batch', inputId: 'a', toMs: null }),
        input({ id: 'i1', batchId: 'b' })
      ],
      sources: new Map([['i1', grazed(5, 15)]]),
      applications: [app()]
    });
    const chains = computeChains(f);
    expect(chains.get('a')!.state).toBe('may-carry');
    expect(chains.get('b')!.state).toBe('may-carry');
    expect(chains.get('a')!.paths).toHaveLength(1);
  });

  describe('hay', () => {
    const cutting = {
      id: 'cut1',
      blockId: 'b-hay',
      blockName: 'Hay field',
      cuttingNumber: 2,
      cutAtMs: at(5)
    };
    const lot = { id: 'lot1', name: 'Round bales', cuttingId: 'cut1' };
    const hayApp = app({ blockId: 'b-hay', fieldId: 'f-hay', appliedAtMs: at(1) });
    const base = () =>
      facts({
        batches: [pile],
        inputs: [input({ id: 'i1', batchId: 'pile' })],
        sources: new Map([
          ['i1', { stays: [], feedReach: [{ subject: goats, fromMs: null, toMs: null }] }]
        ]),
        lots: new Map([['lot1', lot]]),
        cuttings: new Map([['cut1', cutting]]),
        applications: [hayApp]
      });

    it('hay fed from a cutting on a treated block may carry', () => {
      const f = {
        ...base(),
        feedUses: [{ id: 'm1', lotId: 'lot1', atMs: at(12), subject: goats }]
      };
      const chain = computeChains(f).get('pile')!;
      expect(chain.state).toBe('may-carry');
      expect(pathSentence(chain.paths[0], TZ)).toBe(
        'Goats ate hay from Hay field cutting 2, cut on May 6, 2026 after GrazonNext HL on May 2, 2026.'
      );
    });

    it('a spray after the cut does not reach the bales', () => {
      const f = {
        ...base(),
        applications: [{ ...hayApp, appliedAtMs: at(6) }],
        feedUses: [{ id: 'm1', lotId: 'lot1', atMs: at(12), subject: goats }]
      };
      expect(stateOf(f)).toBe('none-on-file');
    });

    it('feed naming another animal does not reach this input', () => {
      const f = {
        ...base(),
        feedUses: [
          {
            id: 'm1',
            lotId: 'lot1',
            atMs: at(12),
            subject: { type: 'animal' as const, id: 'x', name: 'X' }
          }
        ]
      };
      expect(stateOf(f)).toBe('none-on-file');
    });

    it('feed naming nobody makes the input not known (M-31)', () => {
      const f = { ...base(), feedUses: [{ id: 'm1', lotId: 'lot1', atMs: at(12), subject: null }] };
      const chain = computeChains(f).get('pile')!;
      expect(chain.state).toBe('not-known');
      expect(pathSentence(chain.paths[0], TZ)).toMatch(
        /^Hay from Hay field cutting 2 was fed on May 13, 2026 without naming the animals\./
      );
    });

    it('bales put straight in are judged by the cutting, whatever the statement', () => {
      const f = facts({
        batches: [pile],
        inputs: [
          input({
            id: 'i1',
            batchId: 'pile',
            inputType: 'stock-lot',
            inputId: 'lot1',
            toMs: null,
            supplierStatement: 'says-none'
          })
        ],
        lots: new Map([['lot1', lot]]),
        cuttings: new Map([['cut1', cutting]]),
        applications: [hayApp]
      });
      const chain = computeChains(f).get('pile')!;
      expect(chain.state).toBe('may-carry');
      expect(pathSentence(chain.paths[0], TZ)).toContain('went into this pile');
      expect(chain.standingNotes).not.toContain(BOUGHT_FEED_NOTE);
    });
  });

  describe('bought', () => {
    it.each([
      ['says-none', 'none-on-file'],
      ['unknown', 'not-known'],
      ['none-asked', 'not-known'],
      [null, 'not-known']
    ] as const)('a bought load with statement %s is %s', (statement, want) => {
      const f = facts({
        batches: [
          batch({
            id: 'pile',
            origin: 'bought',
            supplier: 'Neighbour',
            supplierStatement: statement
          })
        ]
      });
      const chain = computeChains(f).get('pile')!;
      expect(chain.state).toBe(want);
      if (want === 'not-known') {
        expect(needsSupplierAdvice(chain)).toBe(true);
        expect(pathSentence(chain.paths[0], TZ)).toMatch(/^pile from Neighbour was bought, and /);
      } else {
        expect(chain.standingNotes).toEqual([SUPPLIER_SAID_NONE_NOTE]);
      }
      expect(JSON.stringify(chain)).not.toMatch(/\bsafe\b|\bclear\b/i);
    });

    it('a bought lot without a cutting follows its statement', () => {
      const f = facts({
        batches: [pile],
        inputs: [
          input({
            id: 'i1',
            batchId: 'pile',
            inputType: 'stock-lot',
            inputId: 'lot9',
            toMs: null,
            supplierStatement: 'unknown'
          })
        ],
        lots: new Map([['lot9', { id: 'lot9', name: 'Bagged manure', cuttingId: null }]])
      });
      expect(stateOf(f)).toBe('not-known');
    });

    it('a bought batch inside a home pile passes its state up', () => {
      const f = facts({
        batches: [
          pile,
          batch({
            id: 'load',
            name: 'Horse manure',
            origin: 'bought',
            supplierStatement: 'unknown'
          })
        ],
        inputs: [
          input({ id: 'c', batchId: 'pile', inputType: 'batch', inputId: 'load', toMs: null })
        ]
      });
      expect(stateOf(f)).toBe('not-known');
    });
  });

  it('an empty home pile says no sources yet', () => {
    const chain = computeChains(facts({ batches: [pile] })).get('pile')!;
    expect(chain.state).toBe('none-on-file');
    expect(chain.standingNotes).toEqual([NO_SOURCES_NOTE]);
  });

  it('keeps the first 20 paths, may-carry first, then newest', () => {
    const apps = Array.from({ length: 25 }, (_, k) =>
      app({ ref: `spray:${k}`, appliedAtMs: at(k % 5), unknownProduct: k % 2 === 0 })
    );
    const chain = computeChains(
      facts({
        batches: [pile],
        inputs: [input({ id: 'i1', batchId: 'pile' })],
        sources: new Map([['i1', grazed(5, 15)]]),
        applications: apps
      })
    ).get('pile')!;
    expect(chain.paths).toHaveLength(MAX_PATHS);
    expect(chain.morePaths).toBe(5);
    expect(chain.paths[0].state).toBe('may-carry');
    const firstNotKnown = chain.paths.findIndex((p) => p.state === 'not-known');
    expect(chain.paths.slice(firstNotKnown).every((p) => p.state === 'not-known')).toBe(true);
  });

  it('factsHash is stable and follows the facts', () => {
    const f = facts({
      batches: [pile],
      inputs: [input({ id: 'i1', batchId: 'pile' })],
      sources: new Map([['i1', grazed(5, 15)]]),
      applications: [app()]
    });
    const a = factsHash(computeChains(f).get('pile')!);
    expect(factsHash(computeChains(f).get('pile')!)).toBe(a);
    const g = { ...f, applications: [app({ appliedAtMs: at(1) })] };
    expect(factsHash(computeChains(g).get('pile')!)).not.toBe(a);
  });
});

// ─── Properties ─────────────────────────────────────────────────────────

const N_BATCHES = 5;

interface Gen {
  batches: ChainBatch[];
  inputs: ChainInput[];
  sources: Map<string, ChainSource>;
  applications: ChainApplication[];
}

const genFacts = fc
  .record({
    origins: fc.array(fc.constantFrom('on-farm', 'bought') as fc.Arbitrary<'on-farm' | 'bought'>, {
      minLength: N_BATCHES,
      maxLength: N_BATCHES
    }),
    statements: fc.array(fc.constantFrom('says-none', 'unknown', 'none-asked', null), {
      minLength: N_BATCHES,
      maxLength: N_BATCHES
    }),
    edges: fc.array(fc.tuple(fc.nat({ max: N_BATCHES - 1 }), fc.nat({ max: N_BATCHES - 1 })), {
      maxLength: 10
    }),
    animals: fc.array(
      fc.record({
        batch: fc.nat({ max: N_BATCHES - 1 }),
        from: fc.integer({ min: 0, max: 60 }),
        len: fc.integer({ min: 0, max: 20 }),
        stayFrom: fc.integer({ min: 0, max: 60 }),
        stayLen: fc.integer({ min: 0, max: 20 })
      }),
      { maxLength: 5 }
    ),
    apps: fc.array(
      fc.record({
        day: fc.integer({ min: 0, max: 60 }),
        days: fc.option(fc.integer({ min: 0, max: 10 }), { nil: null }),
        unknown: fc.boolean()
      }),
      { maxLength: 4 }
    )
  })
  .map((g): Gen => {
    const batches = g.origins.map((origin, k) =>
      batch({ id: `b${k}`, origin, supplierStatement: g.statements[k] })
    );
    const inputs: ChainInput[] = g.edges.map(([a, b], k) =>
      input({ id: `e${k}`, batchId: `b${a}`, inputType: 'batch', inputId: `b${b}`, toMs: null })
    );
    const sources = new Map<string, ChainSource>();
    g.animals.forEach((a, k) => {
      const id = `a${k}`;
      inputs.push(
        input({ id, batchId: `b${a.batch}`, fromMs: at(a.from), toMs: at(a.from + a.len) })
      );
      sources.set(id, {
        stays: [
          {
            subject: goats,
            fieldId: 'f-pasture',
            fromMs: at(a.stayFrom),
            toMs: at(a.stayFrom + a.stayLen)
          }
        ],
        feedReach: []
      });
    });
    const applications = g.apps.map((a, k) =>
      app({
        ref: `spray:${k}`,
        appliedAtMs: at(a.day),
        manureCarryoverDays: a.days,
        unknownProduct: a.unknown
      })
    );
    return { batches, inputs, sources, applications };
  });

function run(g: Gen): Map<string, CarryoverState> {
  const chains = computeChains(
    facts({
      batches: g.batches,
      inputs: g.inputs,
      sources: g.sources,
      applications: g.applications
    })
  );
  return new Map([...chains].map(([k, v]) => [k, v.state]));
}

/** Brute-force oracle: a home batch's state is the combined state of every
 *  leaf in every batch it reaches. */
function reach(g: Gen, root: string): Set<string> {
  const byId = new Map(g.batches.map((b) => [b.id, b]));
  const seen = new Set([root]);
  const stack = [root];
  while (stack.length) {
    const id = stack.pop()!;
    if (byId.get(id)?.origin === 'bought') continue;
    for (const i of g.inputs) {
      if (i.batchId === id && i.inputType === 'batch' && !seen.has(i.inputId)) {
        seen.add(i.inputId);
        stack.push(i.inputId);
      }
    }
  }
  return seen;
}

describe('properties', () => {
  it('terminates on any graph and matches the reachability oracle', () => {
    fc.assert(
      fc.property(genFacts, (g) => {
        const states = run(g);
        const own = new Map<string, CarryoverState>();
        for (const b of g.batches) {
          if (b.origin === 'bought') {
            own.set(b.id, b.supplierStatement === 'says-none' ? 'none-on-file' : 'not-known');
            continue;
          }
          const only = {
            ...g,
            inputs: g.inputs.filter((i) => i.batchId === b.id && i.inputType !== 'batch')
          };
          own.set(b.id, run({ ...only, batches: [b] }).get(b.id)!);
        }
        for (const b of g.batches) {
          const want =
            b.origin === 'bought'
              ? own.get(b.id)!
              : combineStates([...reach(g, b.id)].map((id) => own.get(id)!));
          expect(states.get(b.id)).toBe(want);
        }
      }),
      { numRuns: 300 }
    );
  });

  it('an edge back into a batch from anything it reaches never changes that batch', () => {
    fc.assert(
      fc.property(genFacts, fc.nat({ max: N_BATCHES - 1 }), fc.nat({ max: 20 }), (g, r, pick) => {
        const root = `b${r}`;
        const reached = [...reach(g, root)];
        const from = reached[pick % reached.length];
        const before = run(g).get(root);
        const withBack: Gen = {
          ...g,
          inputs: [
            ...g.inputs,
            input({ id: 'back', batchId: from, inputType: 'batch', inputId: root, toMs: null })
          ]
        };
        expect(run(withBack).get(root)).toBe(before);
      }),
      { numRuns: 300 }
    );
  });

  it('adding an input never lowers a batch below its state', () => {
    fc.assert(
      fc.property(
        genFacts,
        fc.nat({ max: N_BATCHES - 1 }),
        fc.oneof(
          fc.record({ kind: fc.constant('batch' as const), to: fc.nat({ max: N_BATCHES - 1 }) }),
          fc.record({
            kind: fc.constant('animal' as const),
            from: fc.integer({ min: 0, max: 60 }),
            stayFrom: fc.integer({ min: 0, max: 60 })
          }),
          fc.record({
            kind: fc.constant('lot' as const),
            statement: fc.constantFrom('says-none', 'unknown', 'none-asked', null)
          })
        ),
        (g, target, add) => {
          const before = run(g);
          const next: Gen = { ...g, inputs: [...g.inputs], sources: new Map(g.sources) };
          const batchId = `b${target}`;
          if (add.kind === 'batch') {
            next.inputs.push(
              input({ id: 'new', batchId, inputType: 'batch', inputId: `b${add.to}`, toMs: null })
            );
          } else if (add.kind === 'animal') {
            next.inputs.push(
              input({ id: 'new', batchId, fromMs: at(add.from), toMs: at(add.from + 5) })
            );
            next.sources.set('new', {
              stays: [
                { subject: goats, fieldId: 'f-pasture', fromMs: at(add.stayFrom), toMs: null }
              ],
              feedReach: []
            });
          } else {
            next.inputs.push(
              input({
                id: 'new',
                batchId,
                inputType: 'stock-lot',
                inputId: 'lotX',
                toMs: null,
                supplierStatement: add.statement
              })
            );
          }
          const after = run(next);
          const rank = { 'none-on-file': 0, 'not-known': 1, 'may-carry': 2 };
          for (const b of g.batches) {
            expect(rank[after.get(b.id)!]).toBeGreaterThanOrEqual(rank[before.get(b.id)!]);
            if (before.get(b.id) === 'may-carry') expect(after.get(b.id)).not.toBe('none-on-file');
          }
        }
      ),
      { numRuns: 300 }
    );
  });
});

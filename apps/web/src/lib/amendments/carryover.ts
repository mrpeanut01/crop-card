/**
 * Phase 33C manure and compost carryover chain (rulings M-25 to M-42).
 *
 * Pure and client-safe. For each amendment batch it finds the paths by which
 * a carryover weed killer (aminopyralid, clopyralid, picloram and kin) could
 * have reached the pile: animals that grazed a treated Area or ate hay cut
 * from a treated block during or just before the collection window, bales
 * put straight in, piles made from other piles, and bought loads judged on
 * what the supplier said. It reports facts and never says a pile is safe.
 *
 * States combine as may-carry > not-known > none-on-file over every path.
 * The batch graph may hold cycles from raced or old rows; a batch reaches
 * each other batch at most once, so every walk ends, and a cycle adds
 * nothing a batch did not already reach.
 */

import { dateTimeFormat } from '$lib/intlCache';
import { t } from '$lib/i18n';
import type { SupplierStatement } from './model';

export type { SupplierStatement } from './model';

export type CarryoverState = 'may-carry' | 'not-known' | 'none-on-file';

export interface SubjectRef {
  type: 'animal' | 'group';
  id: string;
  name: string;
}

export type CarryoverStep =
  | {
      kind: 'graze';
      subject: SubjectRef;
      fieldId: string;
      fieldName: string;
      fromMs: number;
      toMs: number | null;
    }
  | {
      kind: 'fed-hay';
      subject: SubjectRef | null;
      lotId: string;
      cuttingId: string;
      cutAtMs: number;
      fedAtMs: number;
      blockName?: string;
      cuttingNumber?: number | null;
      /** Bales put straight into the pile rather than fed. */
      intoBatch?: boolean;
    }
  | {
      kind: 'application';
      ref: string;
      productName: string;
      productPluginId: string | null;
      appliedAtMs: number;
      manureCarryoverDays: number | null;
      unknownProduct: boolean;
    }
  | { kind: 'batch'; batchId: string; batchName: string }
  /** An animal or group input that is no longer on file. */
  | { kind: 'missing-source'; subject: { type: 'animal' | 'group'; id: string } }
  | {
      kind: 'supplier';
      batchId: string | null;
      lotId: string | null;
      statement: SupplierStatement | null;
      /** What was bought: the lot or the load's name. */
      label?: string;
    };

export interface CarryoverPath {
  state: Exclude<CarryoverState, 'none-on-file'>;
  inputId: string;
  steps: CarryoverStep[];
}

export interface CarryoverChain {
  batchId: string;
  state: CarryoverState;
  /** The first 20, may-carry first, then newest. */
  paths: CarryoverPath[];
  morePaths: number;
  standingNotes: string[];
}

export const MAX_PATHS = 20;
const DAY_MS = 86_400_000;

export const NO_SOURCES_NOTE = 'No sources added yet.';
export const BOUGHT_FEED_NOTE =
  'Bought hay and feed are not traced. If your animals ate bought hay, ask where it grew.';
export const SUPPLIER_SAID_NONE_NOTE = 'The supplier said none was used.';
export const SUPPLIER_ADVICE =
  'Ask the supplier which weed killers were used on the hay or pasture, or run a pea or bean test.';

export interface ChainBatch {
  id: string;
  name: string;
  origin: 'on-farm' | 'bought';
  supplier: string | null;
  supplierStatement: SupplierStatement | null;
  startedAtMs: number;
  closedAtMs: number | null;
}

export interface ChainInput {
  id: string;
  batchId: string;
  inputType: 'animal' | 'group' | 'batch' | 'stock-lot';
  inputId: string;
  fromMs: number;
  toMs: number | null;
  supplierStatement: SupplierStatement | null;
}

export interface SourceStay {
  subject: SubjectRef;
  fieldId: string;
  fromMs: number;
  toMs: number | null;
}

/** A feed use naming `subject` inside `[fromMs, toMs)` reaches the input. */
export interface FeedReach {
  subject: { type: 'animal' | 'group'; id: string };
  fromMs: number | null;
  toMs: number | null;
}

export interface ChainSource {
  stays: SourceStay[];
  feedReach: FeedReach[];
  /** The animal or group was deleted, so its exposure cannot be read. */
  missing?: boolean;
}

export interface ChainFeedUse {
  id: string;
  lotId: string;
  atMs: number;
  subject: SubjectRef | null;
}

export interface ChainLot {
  id: string;
  name: string;
  cuttingId: string | null;
}

export interface ChainCutting {
  id: string;
  blockId: string;
  blockName: string;
  cuttingNumber: number | null;
  cutAtMs: number;
}

/** Only applications that matter: a carryover product (M-25) or a herbicide
 *  with no plugin (`unknownProduct`). The loader filters the rest out. */
export interface ChainApplication {
  ref: string;
  blockId: string;
  /** The Area the application counts on (deleted blocks keep theirs). */
  fieldId: string | null;
  appliedAtMs: number;
  productName: string;
  productPluginId: string | null;
  manureCarryoverDays: number | null;
  unknownProduct: boolean;
}

export interface ChainFacts {
  batches: readonly ChainBatch[];
  inputs: readonly ChainInput[];
  /** Keyed by animal or group input id. */
  sources: ReadonlyMap<string, ChainSource>;
  feedUses: readonly ChainFeedUse[];
  lots: ReadonlyMap<string, ChainLot>;
  cuttings: ReadonlyMap<string, ChainCutting>;
  applications: readonly ChainApplication[];
  fieldNames: ReadonlyMap<string, string>;
  nowMs: number;
}

const RANK: Record<CarryoverState, number> = { 'none-on-file': 0, 'not-known': 1, 'may-carry': 2 };

export function combineStates(states: Iterable<CarryoverState>): CarryoverState {
  let best: CarryoverState = 'none-on-file';
  for (const s of states) if (RANK[s] > RANK[best]) best = s;
  return best;
}

interface Window {
  startMs: number;
  endMs: number;
}

/** M-29 at both edges. */
export function exposureReaches(
  exposure: { startMs: number; endMs: number },
  window: Window,
  days: number | null
): boolean {
  if (exposure.startMs > window.endMs) return false;
  if (days === null) return true;
  return exposure.endMs + days * DAY_MS >= window.startMs;
}

function appStep(a: ChainApplication): CarryoverStep {
  return {
    kind: 'application',
    ref: a.ref,
    productName: a.productName,
    productPluginId: a.productPluginId,
    appliedAtMs: a.appliedAtMs,
    manureCarryoverDays: a.manureCarryoverDays,
    unknownProduct: a.unknownProduct
  };
}

function stateOfApp(a: ChainApplication): CarryoverPath['state'] {
  return a.unknownProduct ? 'not-known' : 'may-carry';
}

interface LeafResult {
  paths: CarryoverPath[];
  /** The leaf rests on a supplier saying none was used. */
  saidNone: boolean;
  /** An on-farm animal or group source, for the standing note. */
  animalSource: boolean;
}

function appsBeforeCut(facts: ChainFacts, cutting: ChainCutting): ChainApplication[] {
  return facts.applications.filter(
    (a) => a.blockId === cutting.blockId && a.appliedAtMs <= cutting.cutAtMs
  );
}

function feedReaches(reach: readonly FeedReach[], use: ChainFeedUse): boolean {
  if (!use.subject) return false;
  const s = use.subject;
  return reach.some(
    (r) =>
      r.subject.type === s.type &&
      r.subject.id === s.id &&
      (r.fromMs === null || r.fromMs <= use.atMs) &&
      (r.toMs === null || use.atMs < r.toMs)
  );
}

function windowOf(input: ChainInput, batch: ChainBatch | undefined, nowMs: number): Window {
  return { startMs: input.fromMs, endMs: input.toMs ?? batch?.closedAtMs ?? nowMs };
}

function animalLeaf(facts: ChainFacts, input: ChainInput, batch: ChainBatch | undefined) {
  const out: CarryoverPath[] = [];
  const window = windowOf(input, batch, facts.nowMs);
  const source: ChainSource = facts.sources.get(input.id) ?? { stays: [], feedReach: [] };
  if (source.missing) {
    out.push({
      state: 'not-known',
      inputId: input.id,
      steps: [
        {
          kind: 'missing-source',
          subject: { type: input.inputType === 'group' ? 'group' : 'animal', id: input.inputId }
        }
      ]
    });
  }
  const appsByField = new Map<string, ChainApplication[]>();
  for (const a of facts.applications) {
    if (!a.fieldId) continue;
    const list = appsByField.get(a.fieldId) ?? [];
    list.push(a);
    appsByField.set(a.fieldId, list);
  }
  for (const stay of source.stays) {
    const endMs = stay.toMs ?? facts.nowMs;
    for (const a of appsByField.get(stay.fieldId) ?? []) {
      if (a.appliedAtMs > endMs) continue;
      const startMs = Math.max(stay.fromMs, a.appliedAtMs);
      if (!exposureReaches({ startMs, endMs }, window, a.manureCarryoverDays)) continue;
      out.push({
        state: stateOfApp(a),
        inputId: input.id,
        steps: [
          {
            kind: 'graze',
            subject: stay.subject,
            fieldId: stay.fieldId,
            fieldName: facts.fieldNames.get(stay.fieldId) ?? 'an Area',
            fromMs: startMs,
            toMs: stay.toMs
          },
          appStep(a)
        ]
      });
    }
  }
  for (const use of facts.feedUses) {
    const lot = facts.lots.get(use.lotId);
    const cutting = lot?.cuttingId ? facts.cuttings.get(lot.cuttingId) : undefined;
    if (!lot || !cutting) continue;
    const named = use.subject !== null;
    if (named && !feedReaches(source.feedReach, use)) continue;
    for (const a of appsBeforeCut(facts, cutting)) {
      const at = { startMs: use.atMs, endMs: use.atMs };
      if (!exposureReaches(at, window, a.manureCarryoverDays)) continue;
      out.push({
        state: named ? stateOfApp(a) : 'not-known',
        inputId: input.id,
        steps: [
          {
            kind: 'fed-hay',
            subject: use.subject,
            lotId: lot.id,
            cuttingId: cutting.id,
            cutAtMs: cutting.cutAtMs,
            fedAtMs: use.atMs,
            blockName: cutting.blockName,
            cuttingNumber: cutting.cuttingNumber
          },
          appStep(a)
        ]
      });
    }
  }
  return out;
}

function supplierPath(
  inputId: string,
  step: Extract<CarryoverStep, { kind: 'supplier' }>
): CarryoverPath {
  return { state: 'not-known', inputId, steps: [step] };
}

function lotLeaf(facts: ChainFacts, input: ChainInput): LeafResult {
  const lot = facts.lots.get(input.inputId);
  const cutting = lot?.cuttingId ? facts.cuttings.get(lot.cuttingId) : undefined;
  if (lot && cutting) {
    const paths = appsBeforeCut(facts, cutting).map((a): CarryoverPath => ({
      state: stateOfApp(a),
      inputId: input.id,
      steps: [
        {
          kind: 'fed-hay',
          subject: null,
          lotId: lot.id,
          cuttingId: cutting.id,
          cutAtMs: cutting.cutAtMs,
          fedAtMs: input.fromMs,
          blockName: cutting.blockName,
          cuttingNumber: cutting.cuttingNumber,
          intoBatch: true
        },
        appStep(a)
      ]
    }));
    return { paths, saidNone: false, animalSource: false };
  }
  if (input.supplierStatement === 'says-none') {
    return { paths: [], saidNone: true, animalSource: false };
  }
  return {
    paths: [
      supplierPath(input.id, {
        kind: 'supplier',
        batchId: null,
        lotId: input.inputId,
        statement: input.supplierStatement,
        label: lot?.name ?? 'A bought lot'
      })
    ],
    saidNone: false,
    animalSource: false
  };
}

function boughtLeaf(batch: ChainBatch, inputId: string): LeafResult {
  if (batch.supplierStatement === 'says-none') {
    return { paths: [], saidNone: true, animalSource: false };
  }
  return {
    paths: [
      supplierPath(inputId, {
        kind: 'supplier',
        batchId: batch.id,
        lotId: null,
        statement: batch.supplierStatement,
        label: batch.supplier ? `${batch.name} from ${batch.supplier}` : batch.name
      })
    ],
    saidNone: false,
    animalSource: false
  };
}

function pathKey(p: CarryoverPath): string {
  return JSON.stringify([p.state, p.steps]);
}

function pathTime(p: CarryoverPath): number {
  let t = Number.NEGATIVE_INFINITY;
  for (const s of p.steps) {
    if (s.kind === 'graze') t = Math.max(t, s.toMs ?? Number.POSITIVE_INFINITY, s.fromMs);
    else if (s.kind === 'fed-hay') t = Math.max(t, s.fedAtMs);
    else if (s.kind === 'application') t = Math.max(t, s.appliedAtMs);
  }
  return t;
}

export function sortPaths(paths: readonly CarryoverPath[]): CarryoverPath[] {
  return paths
    .map((p) => ({ p, k: pathKey(p), t: pathTime(p) }))
    .sort((a, b) => {
      if (a.p.state !== b.p.state) return a.p.state === 'may-carry' ? -1 : 1;
      if (a.t !== b.t) return b.t - a.t;
      return a.k < b.k ? -1 : a.k > b.k ? 1 : 0;
    })
    .map((x) => x.p);
}

/**
 * Every batch's state and paths, computed on read (M-40). A bought batch is
 * a leaf judged on its own statement and never walked into.
 */
export function computeChains(facts: ChainFacts): Map<string, CarryoverChain> {
  const batches = new Map(facts.batches.map((b) => [b.id, b]));
  const inputsByBatch = new Map<string, ChainInput[]>();
  for (const i of facts.inputs) {
    const list = inputsByBatch.get(i.batchId) ?? [];
    list.push(i);
    inputsByBatch.set(i.batchId, list);
  }
  const leafCache = new Map<string, LeafResult>();
  const leafOf = (input: ChainInput): LeafResult | null => {
    if (input.inputType === 'batch') return null;
    const hit = leafCache.get(input.id);
    if (hit) return hit;
    let out: LeafResult;
    if (input.inputType === 'stock-lot') out = lotLeaf(facts, input);
    else {
      out = {
        paths: animalLeaf(facts, input, batches.get(input.batchId)),
        saidNone: false,
        animalSource: true
      };
    }
    leafCache.set(input.id, out);
    return out;
  };

  const result = new Map<string, CarryoverChain>();
  for (const root of facts.batches) {
    const all: CarryoverPath[] = [];
    let saidNone = false;
    let animalSource = false;
    let hasInputs = false;
    if (root.origin === 'bought') {
      const leaf = boughtLeaf(root, root.id);
      all.push(...leaf.paths);
      saidNone = leaf.saidNone;
    } else {
      const route = new Map<string, { prefix: CarryoverStep[]; topInputId: string | null }>();
      route.set(root.id, { prefix: [], topInputId: null });
      const queue: string[] = [root.id];
      while (queue.length) {
        const batchId = queue.shift() as string;
        const here = route.get(batchId) as { prefix: CarryoverStep[]; topInputId: string | null };
        for (const input of inputsByBatch.get(batchId) ?? []) {
          hasInputs = true;
          const topInputId = here.topInputId ?? input.id;
          if (input.inputType === 'batch') {
            const child = batches.get(input.inputId);
            if (!child || route.has(child.id)) continue;
            const prefix: CarryoverStep[] = [
              ...here.prefix,
              { kind: 'batch', batchId: child.id, batchName: child.name }
            ];
            route.set(child.id, { prefix, topInputId });
            if (child.origin === 'bought') {
              const leaf = boughtLeaf(child, topInputId);
              saidNone ||= leaf.saidNone;
              for (const p of leaf.paths) all.push({ ...p, steps: [...prefix, ...p.steps] });
            } else {
              queue.push(child.id);
            }
            continue;
          }
          const leaf = leafOf(input) as LeafResult;
          saidNone ||= leaf.saidNone;
          animalSource ||= leaf.animalSource;
          for (const p of leaf.paths) {
            all.push({ state: p.state, inputId: topInputId, steps: [...here.prefix, ...p.steps] });
          }
        }
      }
    }
    const seen = new Set<string>();
    const unique = sortPaths(all).filter((p) => {
      const k = pathKey(p);
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
    const state = combineStates(unique.map((p) => p.state));
    const standingNotes: string[] = [];
    if (root.origin === 'on-farm' && !hasInputs) standingNotes.push(NO_SOURCES_NOTE);
    if (animalSource) standingNotes.push(BOUGHT_FEED_NOTE);
    if (state === 'none-on-file' && saidNone) standingNotes.push(SUPPLIER_SAID_NONE_NOTE);
    result.set(root.id, {
      batchId: root.id,
      state,
      paths: unique.slice(0, MAX_PATHS),
      morePaths: Math.max(0, unique.length - MAX_PATHS),
      standingNotes
    });
  }
  return result;
}

const STATE_LABELS: Record<CarryoverState, string> = {
  'may-carry': 'May carry a weed killer',
  'not-known': 'Not known',
  'none-on-file': "No carryover weed killer on file for this batch's sources."
};

/** M-42 wording. Never "safe" or "clear". */
export function stateLabel(state: CarryoverState, locale?: string | null): string {
  return locale ? t(locale, `carry.state.${state}`) : STATE_LABELS[state];
}

/** Short chip text for lists. */
export function stateChip(state: CarryoverState, locale?: string | null): string {
  if (state !== 'none-on-file') return stateLabel(state, locale);
  return locale ? t(locale, 'carry.chip.none-on-file') : 'No carryover weed killer on file';
}

/** A standing note for display. Notes about the hazard itself stay English. */
export function standingNoteText(note: string, locale?: string | null): string {
  if (!locale) return note;
  if (note === NO_SOURCES_NOTE) return t(locale, 'carry.note.noSources');
  if (note === SUPPLIER_SAID_NONE_NOTE) return t(locale, 'carry.note.supplierSaidNone');
  return note;
}

/** True when any not-known path rests on a bought load or lot, so the
 *  supplier advice applies. */
export function needsSupplierAdvice(chain: CarryoverChain): boolean {
  return chain.paths.some(
    (p) => p.state === 'not-known' && p.steps.some((s) => s.kind === 'supplier')
  );
}

function day(ms: number, timeZone: string): string {
  try {
    return dateTimeFormat('en-US', {
      timeZone,
      month: 'short',
      day: 'numeric',
      year: 'numeric'
    }).format(new Date(ms));
  } catch {
    return dateTimeFormat('en-US', {
      timeZone: 'UTC',
      month: 'short',
      day: 'numeric',
      year: 'numeric'
    }).format(new Date(ms));
  }
}

function cuttingName(s: Extract<CarryoverStep, { kind: 'fed-hay' }>): string {
  const block = s.blockName ?? 'a hay block';
  return s.cuttingNumber ? `${block} cutting ${s.cuttingNumber}` : `a cutting from ${block}`;
}

function productPhrase(a: Extract<CarryoverStep, { kind: 'application' }>): string {
  return a.unknownProduct ? `${a.productName}, a weed killer not in the library,` : a.productName;
}

const STATEMENT_PHRASE: Record<SupplierStatement, string> = {
  'says-none': 'the supplier said none was used',
  unknown: 'the supplier did not know which weed killers were used',
  'none-asked': 'the supplier has not been asked about weed killers'
};

/** One plain-English sentence per path (M-42). */
export function pathSentence(path: CarryoverPath, timeZone: string): string {
  const batches = path.steps.filter(
    (s): s is Extract<CarryoverStep, { kind: 'batch' }> => s.kind === 'batch'
  );
  const lead = batches.length ? `Through ${batches.map((b) => b.batchName).join(', then ')}: ` : '';
  const app = path.steps.find(
    (s): s is Extract<CarryoverStep, { kind: 'application' }> => s.kind === 'application'
  );
  const last = path.steps.filter((s) => s.kind !== 'batch' && s.kind !== 'application')[0];
  if (!last) return lead.trim();
  if (last.kind === 'graze' && app) {
    const to = last.toMs === null ? 'now' : day(last.toMs, timeZone);
    return `${lead}${last.subject.name} grazed ${last.fieldName} from ${day(last.fromMs, timeZone)} to ${to}, after ${productPhrase(app)} was sprayed there on ${day(app.appliedAtMs, timeZone)}.`;
  }
  if (last.kind === 'fed-hay' && app) {
    const cut = `cut on ${day(last.cutAtMs, timeZone)} after ${productPhrase(app)} on ${day(app.appliedAtMs, timeZone)}`;
    if (last.intoBatch) {
      return `${lead}Hay from ${cuttingName(last)}, ${cut}, went into this pile.`;
    }
    if (!last.subject) {
      return `${lead}Hay from ${cuttingName(last)} was fed on ${day(last.fedAtMs, timeZone)} without naming the animals. It was ${cut}.`;
    }
    return `${lead}${last.subject.name} ate hay from ${cuttingName(last)}, ${cut}.`;
  }
  if (last.kind === 'missing-source') {
    const who = last.subject.type === 'group' ? 'A group' : 'An animal';
    return `${lead}${who} added to this pile is no longer on file, so where it grazed and what it ate is not known.`;
  }
  if (last.kind === 'supplier') {
    const what = last.label ?? 'A bought load';
    const said = last.statement
      ? STATEMENT_PHRASE[last.statement]
      : 'no answer from the supplier is on file';
    return `${lead}${what} was bought, and ${said}.`;
  }
  return lead.trim();
}

/** cyrb53, a small stable string hash; not cryptographic. */
function cyrb53(str: string, seed = 0): string {
  let h1 = 0xdeadbeef ^ seed;
  let h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (h2 >>> 0).toString(16).padStart(8, '0') + (h1 >>> 0).toString(16).padStart(8, '0');
}

/** Stable over the state and the paths shown (M-45 confirm token). */
export function factsHash(chain: CarryoverChain): string {
  return cyrb53(
    JSON.stringify({ s: chain.state, p: chain.paths, m: chain.morePaths, b: chain.batchId })
  );
}

/** True when `from` reaches `target` through batch inputs (`from` itself
 *  included), so adding `target` → `from` would close a cycle (M-34). */
export function batchReaches(
  inputs: readonly Pick<ChainInput, 'batchId' | 'inputType' | 'inputId'>[],
  from: string,
  target: string
): boolean {
  const seen = new Set([from]);
  const stack = [from];
  while (stack.length) {
    const id = stack.pop() as string;
    if (id === target) return true;
    for (const i of inputs) {
      if (i.batchId === id && i.inputType === 'batch' && !seen.has(i.inputId)) {
        seen.add(i.inputId);
        stack.push(i.inputId);
      }
    }
  }
  return false;
}

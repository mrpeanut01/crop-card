/**
 * Phase 33C after-spread lines (M-47, M-48). Pure and client-safe. The
 * server works out each spread's batch state (`lib/server/areaCarryover.ts`)
 * and this module turns it into one plain line per fertility application,
 * then adds those lines to the Area Card, the /plan Block cards and the
 * Planting card. Advisory display only: nothing here blocks a write, and
 * no line ever says a block is safe or clear.
 */

import { formatCalendarDate, ymdInZone } from '$lib/prefs';
import type { CarryoverState } from '$lib/amendments/carryover';
import { HARMS_TEXT } from '$lib/amendments/spreadPrompt';
import { BIOASSAY_DAMAGE_TEXT } from '$lib/amendments/bioassayGuide';
import {
  mergeProvenance,
  type CardAction,
  type CardModel,
  type CardSection
} from '$lib/cards/model';

export interface CarryoverLine {
  blockId: string;
  applicationId: string;
  batchId: string;
  tone: 'warn' | 'muted';
  text: string;
  provenance: 'data';
}

export type CarryoverByBlock = Record<string, CarryoverLine[]>;

export const CARRYOVER_SECTION = 'Weed killer carryover';
export const CARRYOVER_TESTS_SECTION = 'Pea or bean tests';
export const CARRYOVER_SECTION_TITLES = [CARRYOVER_SECTION, CARRYOVER_TESTS_SECTION] as const;
export const AREA_LINE_LIMIT = 3;

export interface SpreadFact {
  applicationId: string;
  blockId: string;
  batchId: string;
  occurredAt: number;
}

export interface BioassayFact {
  id: string;
  batchId: string | null;
  blockId: string | null;
  testedAt: number;
  createdAt: number;
  result: 'no-damage' | 'damage';
}

export interface CarryoverLineFacts {
  spreads: readonly SpreadFact[];
  states: ReadonlyMap<string, CarryoverState>;
  batchNames: ReadonlyMap<string, string>;
  /** `created_at` of each batch's newest input (M-48). */
  newestInputAt: ReadonlyMap<string, number>;
  bioassays: readonly BioassayFact[];
  dismissedApplicationIds: ReadonlySet<string>;
  timeZone: string;
}

function dayOf(ms: number, timeZone: string): string {
  try {
    return ymdInZone(ms, timeZone);
  } catch {
    return ymdInZone(ms, 'UTC');
  }
}

function dateText(ms: number, timeZone: string): string {
  return formatCalendarDate(dayOf(ms, timeZone), 'date');
}

function newer(a: BioassayFact, b: BioassayFact): boolean {
  return a.testedAt !== b.testedAt ? a.testedAt > b.testedAt : a.createdAt > b.createdAt;
}

/** M-48: the latest bioassay that counts for this spread, if any. A block
 *  test counts from the spread's day; a batch test from the day of the
 *  batch's newest input. */
export function countingBioassay(
  spread: SpreadFact,
  bioassays: readonly BioassayFact[],
  newestInputAt: number | undefined,
  timeZone: string
): BioassayFact | null {
  const spreadDay = dayOf(spread.occurredAt, timeZone);
  const inputDay = newestInputAt === undefined ? null : dayOf(newestInputAt, timeZone);
  let best: BioassayFact | null = null;
  for (const b of bioassays) {
    const testDay = dayOf(b.testedAt, timeZone);
    const counts =
      (b.blockId === spread.blockId && testDay >= spreadDay) ||
      (b.batchId === spread.batchId && (inputDay === null || testDay >= inputDay));
    if (counts && (!best || newer(b, best))) best = b;
  }
  return best;
}

export function lineText(
  state: Exclude<CarryoverState, 'none-on-file'>,
  batchName: string,
  spreadAt: number,
  test: BioassayFact | null,
  timeZone: string
): { tone: 'warn' | 'muted'; text: string } {
  const got = `Got ${batchName} on ${dateText(spreadAt, timeZone)}`;
  if (test?.result === 'no-damage') {
    return {
      tone: 'muted',
      text: `${got}. Your pea or bean test on ${dateText(test.testedAt, timeZone)} showed no damage.`
    };
  }
  if (test?.result === 'damage') {
    return {
      tone: 'warn',
      text: `${got}. Your pea or bean test on ${dateText(test.testedAt, timeZone)} showed damage. ${BIOASSAY_DAMAGE_TEXT}`
    };
  }
  if (state === 'may-carry') {
    return {
      tone: 'warn',
      text: `${got}, which may carry a weed killer that harms ${HARMS_TEXT}. Consider a pea or bean test before planting.`
    };
  }
  return {
    tone: 'warn',
    text: `${got}. Whether it carries a weed killer that harms ${HARMS_TEXT} is not known. Consider a pea or bean test before planting.`
  };
}

/** M-47: one line per spread whose batch is may-carry or not-known now,
 *  unless that application was dismissed. Newest spread first. */
export function buildCarryoverLines(facts: CarryoverLineFacts): CarryoverByBlock {
  const out: CarryoverByBlock = {};
  const spreads = [...facts.spreads].sort((a, b) => b.occurredAt - a.occurredAt);
  for (const s of spreads) {
    if (facts.dismissedApplicationIds.has(s.applicationId)) continue;
    const state = facts.states.get(s.batchId);
    if (state !== 'may-carry' && state !== 'not-known') continue;
    const test = countingBioassay(
      s,
      facts.bioassays,
      facts.newestInputAt.get(s.batchId),
      facts.timeZone
    );
    const { tone, text } = lineText(
      state,
      facts.batchNames.get(s.batchId) ?? 'a manure or compost batch',
      s.occurredAt,
      test,
      facts.timeZone
    );
    (out[s.blockId] ??= []).push({
      blockId: s.blockId,
      applicationId: s.applicationId,
      batchId: s.batchId,
      tone,
      text,
      provenance: 'data'
    });
  }
  return out;
}

export function carryoverHref(blockId: string): string {
  return `/plan/blocks/${encodeURIComponent(blockId)}/carryover`;
}

/** Lines for the given blocks, in block order. */
export function linesForBlocks(
  byBlock: CarryoverByBlock | null | undefined,
  blockIds: readonly string[]
): CarryoverLine[] {
  if (!byBlock) return [];
  return blockIds.flatMap((id) => byBlock[id] ?? []);
}

export interface WithCarryoverOptions {
  /** Prefix each line with its block's name (the Area Card). */
  blockNames?: ReadonlyMap<string, string> | Record<string, string>;
  /** At most this many lines, then "and <n> more". */
  max?: number;
  /** Add a screen link per block to the pea test and dismiss page. */
  link?: boolean;
}

function nameOf(names: WithCarryoverOptions['blockNames'], id: string): string | undefined {
  if (!names) return undefined;
  return names instanceof Map ? names.get(id) : (names as Record<string, string>)[id];
}

/** The card with its carryover lines. Unchanged when there are none, and
 *  safe to apply twice (the sections are replaced, not repeated). */
export function withCarryover(
  card: CardModel,
  lines: readonly CarryoverLine[],
  opts: WithCarryoverOptions = {}
): CardModel {
  if (!lines.length) return card;
  const shown = opts.max !== undefined ? lines.slice(0, opts.max) : lines;
  const more = lines.length - shown.length;
  const text = (l: CarryoverLine) => {
    const name = nameOf(opts.blockNames, l.blockId);
    return name ? `${name}: ${l.text}` : l.text;
  };
  const warn = shown.filter((l) => l.tone === 'warn').map(text);
  const muted = shown.filter((l) => l.tone === 'muted').map(text);
  const tail = more > 0 ? [`and ${more} more`] : [];
  const sections: CardSection[] = [];
  if (warn.length) {
    sections.push({
      title: CARRYOVER_SECTION,
      items: muted.length ? warn : [...warn, ...tail],
      safety: true,
      provenance: 'data'
    });
  }
  if (muted.length) {
    sections.push({
      title: CARRYOVER_TESTS_SECTION,
      items: [...muted, ...tail],
      provenance: 'data'
    });
  }
  const kept = card.sections.filter(
    (s) => !(CARRYOVER_SECTION_TITLES as readonly string[]).includes(s.title)
  );
  const links: CardAction[] = [...(card.links ?? [])];
  if (opts.link) {
    const blocks = [...new Set(shown.map((l) => l.blockId))];
    for (const id of blocks) {
      const href = carryoverHref(id);
      if (links.some((l) => l.href === href)) continue;
      const name = nameOf(opts.blockNames, id);
      links.push({ label: name ? `Pea test or dismiss: ${name}` : 'Pea test or dismiss', href });
    }
  }
  return {
    ...card,
    sections: [...sections, ...kept],
    provenance: mergeProvenance([...card.provenance, { source: 'data', detail: 'your records' }]),
    ...(links.length ? { links } : {})
  };
}

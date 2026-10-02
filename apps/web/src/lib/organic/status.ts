/**
 * Owner-entered organic status (33B, rulings B-07 to B-15). Pure and
 * client-safe: the projection over entries, the one status line every
 * surface prints, and when organic chrome shows at all. The app never
 * infers a status; a subject with no entry has none (O-01).
 */

import type { FarmProfile } from '$lib/onboarding/profile';
import type { Philosophy } from '$lib/season/setup';

export const ORGANIC_STATUSES = ['organic', 'transitioning', 'not-organic'] as const;
export type OrganicStatus = (typeof ORGANIC_STATUSES)[number];
export const ORGANIC_SUBJECT_TYPES = ['field', 'block', 'animal', 'group'] as const;
export type OrganicSubjectType = (typeof ORGANIC_SUBJECT_TYPES)[number];

export const ORGANIC_STATUS_LABEL: Readonly<Record<OrganicStatus, string>> = {
  organic: 'Organic',
  transitioning: 'Transitioning',
  'not-organic': 'Not organic'
};

export interface OrganicStatusEntry {
  id: string;
  subjectType: OrganicSubjectType;
  subjectId: string;
  status: OrganicStatus;
  effectiveAt: number;
  certifier: string | null;
  note: string | null;
  createdBy: string | null;
  createdAt: number;
  documentIds: string[];
}

export interface EffectiveOrganicStatus {
  status: OrganicStatus;
  effectiveAt: number;
  certifier: string | null;
  entryId: string;
  inheritedFrom: { subjectType: 'field' | 'group'; subjectId: string; name: string } | null;
  /** Animals and groups only; always null for land. */
  lost: { at: number; healthEventId: string; basis: 'rule' | 'owner-review' } | null;
}

type EntryLike = Pick<OrganicStatusEntry, 'id' | 'status' | 'effectiveAt' | 'createdAt'> & {
  certifier: string | null;
};

/** The entry in force at `atMs`: the latest `effectiveAt` on or before it,
 *  then the latest `createdAt` (a same-day correction wins), then the id. */
export function entryInForce<T extends EntryLike>(entries: readonly T[], atMs: number): T | null {
  let best: T | null = null;
  for (const e of entries) {
    if (e.effectiveAt > atMs) continue;
    if (
      !best ||
      e.effectiveAt > best.effectiveAt ||
      (e.effectiveAt === best.effectiveAt &&
        (e.createdAt > best.createdAt || (e.createdAt === best.createdAt && e.id > best.id)))
    ) {
      best = e;
    }
  }
  return best;
}

function fromEntry(
  e: EntryLike,
  inheritedFrom: EffectiveOrganicStatus['inheritedFrom'] = null
): EffectiveOrganicStatus {
  return {
    status: e.status,
    effectiveAt: e.effectiveAt,
    certifier: e.certifier,
    entryId: e.id,
    inheritedFrom,
    lost: null
  };
}

/** B-09: the block's own entry in force wins; else its Area's; else none.
 *  A later Area entry never overrides an earlier block entry. */
export function resolveBlockStatus(
  blockEntries: readonly EntryLike[],
  area: { id: string; name: string; entries: readonly EntryLike[] } | null,
  atMs: number
): EffectiveOrganicStatus | null {
  const own = entryInForce(blockEntries, atMs);
  if (own) return fromEntry(own);
  if (!area) return null;
  const inherited = entryInForce(area.entries, atMs);
  return inherited
    ? fromEntry(inherited, { subjectType: 'field', subjectId: area.id, name: area.name })
    : null;
}

/** An Area's own entry in force. */
export function resolveAreaStatus(
  entries: readonly EntryLike[],
  atMs: number
): EffectiveOrganicStatus | null {
  const own = entryInForce(entries, atMs);
  return own ? fromEntry(own) : null;
}

export interface GroupCandidate {
  id: string;
  name: string;
  /** The group's effective status at the date, its loss included. */
  status: EffectiveOrganicStatus | null;
}

/**
 * B-10: an animal's own entry in force wins; with none, it inherits the
 * group it belonged to at that date, loss included, labelled with the
 * group. When the history leaves more than one group possible, a lost one
 * wins, then the latest entry, so the doubt never reads as "Organic".
 * `ownLoss` is the animal's own loss, which no entry clears (O-10).
 */
export function resolveAnimalStatus(
  ownEntries: readonly EntryLike[],
  groups: readonly GroupCandidate[],
  ownLoss: EffectiveOrganicStatus['lost'],
  atMs: number
): EffectiveOrganicStatus | null {
  const own = entryInForce(ownEntries, atMs);
  if (own) return { ...fromEntry(own), lost: ownLoss };
  let best: GroupCandidate | null = null;
  for (const g of groups) {
    if (!g.status) continue;
    if (
      !best?.status ||
      (g.status.lost && !best.status.lost) ||
      (!!g.status.lost === !!best.status.lost && g.status.effectiveAt > best.status.effectiveAt)
    ) {
      best = g;
    }
  }
  if (!best?.status) {
    return null;
  }
  const lost =
    ownLoss && best.status.lost
      ? ownLoss.at <= best.status.lost.at
        ? ownLoss
        : best.status.lost
      : (ownLoss ?? best.status.lost);
  return {
    ...best.status,
    inheritedFrom: { subjectType: 'group', subjectId: best.id, name: best.name },
    lost
  };
}

/** B-14: the one status line the page, Cards, notices and the pack print.
 *  Null when there is no status (the caller renders nothing, O-01). */
export function organicStatusLine(
  s: EffectiveOrganicStatus | null,
  fmtDate: (ms: number) => string
): string | null {
  if (!s) return null;
  const parts = [`owner-entered`, `effective ${fmtDate(s.effectiveAt)}`];
  const certifier = s.certifier?.trim();
  if (certifier) parts.push(`certifier ${certifier}`);
  const from = s.inheritedFrom
    ? s.inheritedFrom.subjectType === 'group'
      ? ` from group ${s.inheritedFrom.name}`
      : ` from ${s.inheritedFrom.name}`
    : '';
  const base = `${ORGANIC_STATUS_LABEL[s.status]} (${parts.join(', ')})${from}`;
  if (s.lost && s.status !== 'not-organic') {
    const why = s.lost.basis === 'owner-review' ? ', as the owner answered' : '';
    return `Status lost after a treatment on ${fmtDate(s.lost.at)}${why}. Was: ${base}`;
  }
  return base;
}

/** True when the subject is under organic management at the date. */
export function isUnderOrganic(s: EffectiveOrganicStatus | null): boolean {
  return !!s && !s.lost && (s.status === 'organic' || s.status === 'transitioning');
}

export type OrganicChromeLevel = 'none' | 'entry' | 'full';

/** B-15: `full` once the farm has any status entry; `entry` (the owner's
 *  one link on /records) for a farm, mixed or unanswered profile or an
 *  organic Season Setup philosophy; `none` for a garden household. */
export function organicChromeLevel(input: {
  hasStatusRows: boolean;
  profile: FarmProfile | null;
  philosophy: Philosophy | null;
}): OrganicChromeLevel {
  if (input.hasStatusRows) return 'full';
  if (input.profile !== 'garden') return 'entry';
  if (input.philosophy === 'organic-transitioning' || input.philosophy === 'certified-organic') {
    return 'entry';
  }
  return 'none';
}

/** B-08: a farm-local `YYYY-MM-DD`, from 1970 to one year past today. */
export const EFFECTIVE_DAY_MIN = '1970-01-01';

export function maxEffectiveDay(todayYmd: string): string {
  const [y, m, d] = todayYmd.split('-').map(Number);
  const next = new Date(Date.UTC(y + 1, m - 1, d));
  if (next.getUTCMonth() !== m - 1) next.setUTCDate(0);
  return next.toISOString().slice(0, 10);
}

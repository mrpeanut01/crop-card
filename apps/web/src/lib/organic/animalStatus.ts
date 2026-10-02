/**
 * Organic status of animals and groups after treatment (33B, rulings B-22
 * to B-26, O-08 to O-10). Pure: the server module gathers the records.
 *
 * A treatment (a dose of a hold-bearing kind) is looked at only when a
 * subject it reached was under organic management when it was given. Its
 * outcome is a loss only by the rule (when `NOP_RULES.treatedAnimalRule`
 * is on and the library says antibiotic or not allowed) or by the owner's
 * answer; otherwise it waits for review. The app never decides "not
 * affected" (O-09), and a loss is one-way (O-10).
 */

import type { NopRules } from './nopRules';
import {
  isUnderOrganic,
  resolveAnimalStatus,
  resolveAreaStatus,
  type EffectiveOrganicStatus,
  type OrganicStatusEntry
} from './status';
import type { OrganicReviewOutcome } from './apiSchemas';

export type AnimalOrganicSubject = { type: 'animal' | 'group'; id: string };
export type OrganicLoss = NonNullable<EffectiveOrganicStatus['lost']>;

export interface TreatmentReviewView {
  outcome: OrganicReviewOutcome;
  reason: string;
  createdAt: number;
  lockedAt: number | null;
  by: { id: string; label: string } | null;
}

export interface OrganicTreatmentInput {
  healthEventId: string;
  subjectType: 'animal' | 'group';
  subjectId: string;
  administeredAt: number;
  courseEndAt: number | null;
  product: string;
  pluginId: string | null;
  /** A deleted dose that was given (B-26). Voids never reach here. */
  deleted: boolean;
  review: TreatmentReviewView | null;
}

export interface TreatmentOrganicRow {
  healthEventId: string;
  administeredAt: number;
  subjects: AnimalOrganicSubject[];
  product: string;
  outcome: 'status-lost' | 'needs-review' | 'not-affected';
  basis: 'rule' | 'owner-review' | null;
  review: TreatmentReviewView | null;
  deleted: boolean;
  /** B-23: a sourced allowed or allowed-with-conditions library entry,
   *  shown beside the review question. It never decides the outcome. */
  organicUse: OrganicUseFact | null;
}

export interface OrganicUseFact {
  status: 'allowed' | 'allowed-with-conditions' | 'not-allowed';
  citation: string;
  conditions?: string;
}

export interface AnimalOrganicWorld {
  entries(subject: AnimalOrganicSubject): readonly OrganicStatusEntry[];
  groupName(groupId: string): string;
  /** Groups the animal may have been in at the moment. */
  groupsAt(animalId: string, atMs: number): readonly string[];
  /** Animals in the group at any moment from `fromMs` to `toMs`. */
  membersDuring(groupId: string, fromMs: number, toMs: number): readonly string[];
  plugin(pluginId: string): { productKind: string; organicUse?: OrganicUseFact } | undefined;
  rules: Readonly<NopRules>;
}

export interface AnimalOrganicProjection {
  rows: TreatmentOrganicRow[];
  losses: ReadonlyMap<string, OrganicLoss>;
  statusAt(subject: AnimalOrganicSubject, atMs: number): EffectiveOrganicStatus | null;
}

export const subjectKey = (s: AnimalOrganicSubject) => `${s.type}:${s.id}`;

/** B-23: the rule decides only while it is switched on. */
export function ruleLoss(
  pluginId: string | null,
  world: Pick<AnimalOrganicWorld, 'plugin' | 'rules'>
): boolean {
  if (!world.rules.treatedAnimalRule || !pluginId) return false;
  const p = world.plugin(pluginId);
  if (!p) return false;
  return p.productKind === 'antibiotic' || p.organicUse?.status === 'not-allowed';
}

export function projectAnimalOrganic(
  treatments: readonly OrganicTreatmentInput[],
  world: AnimalOrganicWorld
): AnimalOrganicProjection {
  const losses = new Map<string, OrganicLoss>();
  const lossAt = (s: AnimalOrganicSubject, atMs: number) => {
    const l = losses.get(subjectKey(s));
    return l && l.at <= atMs ? l : null;
  };
  const entriesAsOf = (s: AnimalOrganicSubject, asOf: number | undefined) => {
    const all = world.entries(s);
    return asOf === undefined ? all : all.filter((e) => e.createdAt <= asOf);
  };
  const groupStatusAt = (
    groupId: string,
    atMs: number,
    asOf?: number
  ): EffectiveOrganicStatus | null => {
    const base = resolveAreaStatus(entriesAsOf({ type: 'group', id: groupId }, asOf), atMs);
    return base ? { ...base, lost: lossAt({ type: 'group', id: groupId }, atMs) } : null;
  };
  const statusAsOf = (
    s: AnimalOrganicSubject,
    atMs: number,
    asOf?: number
  ): EffectiveOrganicStatus | null => {
    if (s.type === 'group') return groupStatusAt(s.id, atMs, asOf);
    const groups = world.groupsAt(s.id, atMs).map((id) => ({
      id,
      name: world.groupName(id),
      status: groupStatusAt(id, atMs, asOf)
    }));
    return resolveAnimalStatus(entriesAsOf(s, asOf), groups, lossAt(s, atMs), atMs);
  };
  const statusAt = (s: AnimalOrganicSubject, atMs: number) => statusAsOf(s, atMs);

  const rows: TreatmentOrganicRow[] = [];
  const ordered = [...treatments].sort(
    (a, b) => a.administeredAt - b.administeredAt || a.healthEventId.localeCompare(b.healthEventId)
  );
  for (const t of ordered) {
    const reached: AnimalOrganicSubject[] = [{ type: t.subjectType, id: t.subjectId }];
    if (t.subjectType === 'group') {
      const end = Math.max(t.administeredAt, t.courseEndAt ?? t.administeredAt);
      for (const id of world.membersDuring(t.subjectId, t.administeredAt, end)) {
        reached.push({ type: 'animal', id });
      }
    }
    // An answered review was given against the status history on file at
    // that moment. Entries added later (even backdated ones) can widen the
    // set it covers but never take a subject out of it, so a confirmed
    // loss and a locked review stay on the record (O-10, B-25).
    const answeredAt = t.review?.createdAt;
    const considered = reached.filter(
      (s) =>
        isUnderOrganic(statusAt(s, t.administeredAt)) ||
        (answeredAt !== undefined && isUnderOrganic(statusAsOf(s, t.administeredAt, answeredAt)))
    );
    if (considered.length === 0) continue;
    let outcome: TreatmentOrganicRow['outcome'] = 'needs-review';
    let basis: TreatmentOrganicRow['basis'] = null;
    if (ruleLoss(t.pluginId, world)) {
      outcome = 'status-lost';
      basis = 'rule';
    } else if (t.review) {
      outcome = t.review.outcome;
      basis = 'owner-review';
    }
    if (outcome === 'status-lost' && basis) {
      for (const s of considered) {
        if (!losses.has(subjectKey(s))) {
          losses.set(subjectKey(s), {
            at: t.administeredAt,
            healthEventId: t.healthEventId,
            basis
          });
        }
      }
    }
    const use = t.pluginId ? world.plugin(t.pluginId)?.organicUse : undefined;
    rows.push({
      healthEventId: t.healthEventId,
      administeredAt: t.administeredAt,
      subjects: considered,
      product: t.product,
      outcome,
      basis,
      review: t.review,
      deleted: t.deleted,
      organicUse: use && use.status !== 'not-allowed' ? use : null
    });
  }
  return { rows, losses, statusAt };
}

/** B-23: the plain words for a library organic-use fact. */
export function organicUseFactLine(fact: OrganicUseFact): string {
  const what =
    fact.status === 'allowed'
      ? 'allowed for organic use'
      : 'allowed for organic use with conditions';
  const conditions = fact.conditions?.trim() ? ` Conditions: ${fact.conditions.trim()}.` : '';
  return `Library entry: ${what} (${fact.citation}).${conditions} This is a fact to weigh, not the answer.`;
}

export const DELETED_BEFORE_REVIEW = 'Treatment record deleted before review. Tell your certifier.';

export const OUTCOME_LABEL: Readonly<Record<TreatmentOrganicRow['outcome'], string>> = {
  'status-lost': 'Status lost',
  'needs-review': 'Needs review',
  'not-affected': 'Owner answered: does not end it'
};

/** The plain words for a row's organic outcome, used on pages and in the
 *  treatment log (B-50). */
export function treatmentOutcomeText(row: TreatmentOrganicRow): string {
  if (row.outcome === 'needs-review' && row.deleted) return DELETED_BEFORE_REVIEW;
  if (row.outcome === 'status-lost' && row.basis === 'owner-review') {
    return 'Status lost (owner answered: ends organic status)';
  }
  return OUTCOME_LABEL[row.outcome];
}

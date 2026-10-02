/** Request schemas for /api/organic/** (33B, B-54). Client-safe. */

import { z } from 'zod';
import { t } from '$lib/i18n';
import { ORGANIC_STATUSES, ORGANIC_SUBJECT_TYPES } from './status';

const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'use YYYY-MM-DD');

export const organicStatusCreateSchema = z.strictObject({
  subjectType: z.enum(ORGANIC_SUBJECT_TYPES),
  subjectId: z.string().min(1).max(64),
  status: z.enum(ORGANIC_STATUSES),
  /** Farm-local day the status takes effect (B-08). */
  effectiveOn: ymd,
  certifier: z.string().trim().max(120).nullish(),
  note: z.string().trim().max(1000).nullish(),
  /** A vault document uploaded first (B-13). */
  documentId: z.string().min(1).max(64).nullish()
});
export type OrganicStatusCreate = z.infer<typeof organicStatusCreateSchema>;

export const organicStatusQuerySchema = z.strictObject({
  subjectType: z.enum(ORGANIC_SUBJECT_TYPES).optional(),
  subjectId: z.string().min(1).max(64).optional()
});

export const ORGANIC_REVIEW_OUTCOMES = ['status-lost', 'not-affected'] as const;
export type OrganicReviewOutcome = (typeof ORGANIC_REVIEW_OUTCOMES)[number];

export const ORGANIC_REVIEW_OUTCOME_LABEL: Readonly<Record<OrganicReviewOutcome, string>> = {
  'status-lost': 'Ends organic status',
  'not-affected': 'Does not end it'
};

export function reviewOutcomeLabel(o: OrganicReviewOutcome, locale?: string | null): string {
  if (!locale) return ORGANIC_REVIEW_OUTCOME_LABEL[o];
  return t(locale, o === 'status-lost' ? 'organic.review.endsStatus' : 'organic.review.doesNotEnd');
}

export const treatmentReviewSchema = z.strictObject({
  healthEventId: z.string().min(1).max(64),
  outcome: z.enum(ORGANIC_REVIEW_OUTCOMES),
  reason: z.string().trim().min(3).max(500)
});
export type TreatmentReviewInput = z.infer<typeof treatmentReviewSchema>;

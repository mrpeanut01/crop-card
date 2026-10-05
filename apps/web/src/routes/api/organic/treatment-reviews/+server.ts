import { json, type RequestHandler } from '@sveltejs/kit';
import { t } from '$lib/i18n';
import { getHealthEvent } from '$lib/db/animalHealth';
import { evaluateReviewLock, getReviewForHealthEvent, upsertReview } from '$lib/db/organicReviews';
import { requireUser } from '$lib/server/auth';
import { invalidBody, organicWriteRefusal } from '$lib/organic/access.server';
import { treatmentReviewSchema } from '$lib/organic/apiSchemas';
import { organicTreatmentOutcomes } from '$lib/organic/animalStatus.server';
import { organicHealthPlugins } from '$lib/organic/plugins.server';

export const _requestSchema = treatmentReviewSchema;

/**
 * B-25: the owner's one answer per treatment, changeable for 48 hours from
 * the first answer. Not gated by the season close-out; online only.
 */
export const POST: RequestHandler = async (event) => {
  const user = requireUser(event);
  const refused = organicWriteRefusal(user, event.locals?.locale);
  if (refused) return refused;
  let body: unknown;
  try {
    body = await event.request.json();
  } catch {
    return json(
      { error: t(event.locals?.locale, 'stockui.api.invalidJsonShort') },
      { status: 400 }
    );
  }
  const parsed = treatmentReviewSchema.safeParse(body);
  if (!parsed.success) return invalidBody(parsed.error.issues);
  const input = parsed.data;
  if (!getHealthEvent(input.healthEventId)) {
    return json(
      { error: t(event.locals?.locale, 'api.errB.unknownHealthEventId') },
      { status: 400 }
    );
  }
  const plugins = await organicHealthPlugins();
  const row = organicTreatmentOutcomes({ plugins }).find(
    (r) => r.healthEventId === input.healthEventId
  );
  if (!row || row.basis === 'rule') {
    return json(
      {
        error: 'REVIEW_NOT_NEEDED',
        message: t(
          event.locals?.locale,
          row ? 'organic.api.libraryDecides' : 'organic.api.notReached'
        )
      },
      { status: 409 }
    );
  }
  const existing = getReviewForHealthEvent(input.healthEventId);
  if (existing && evaluateReviewLock(existing) !== null) {
    return json(
      {
        error: 'REVIEW_LOCKED',
        message: t(event.locals?.locale, 'organic.api.reviewLocked')
      },
      { status: 409 }
    );
  }
  const review = upsertReview({
    healthEventId: input.healthEventId,
    outcome: input.outcome,
    reason: input.reason,
    createdBy: user.id
  });
  const after = organicTreatmentOutcomes({ plugins }).find(
    (r) => r.healthEventId === input.healthEventId
  );
  return json({ review, treatment: after ?? null }, { status: existing ? 200 : 201 });
};

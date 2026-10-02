import { json, type RequestHandler } from '@sveltejs/kit';
import { t } from '$lib/i18n';
import { db } from '$lib/db/client';
import { getBlock } from '$lib/db/blocks';
import { getField } from '$lib/db/fields';
import { getAnimal } from '$lib/db/animals';
import { getAnimalGroup } from '$lib/db/animalGroups';
import { insertDocumentLink } from '$lib/db/documents';
import { insertOrganicStatusEntry, listOrganicStatusEntries } from '$lib/db/organicStatus';
import { farmTimeZone } from '$lib/db/userProfile';
import { isCropBearing } from '$lib/farm/areaKinds';
import { zonedDayStartMs } from '$lib/exports/dateRange';
import { DEFAULT_PREFS, todayYmd } from '$lib/prefs';
import { requireUser } from '$lib/server/auth';
import { checkLabReport } from '$lib/server/soilTestDocument';
import { invalidBody, organicWriteRefusal } from '$lib/organic/access.server';
import { organicStatusCreateSchema, organicStatusQuerySchema } from '$lib/organic/apiSchemas';
import { EFFECTIVE_DAY_MIN, maxEffectiveDay } from '$lib/organic/status';

export const _requestSchema = organicStatusCreateSchema;
export const _querySchema = organicStatusQuerySchema;

function subjectExists(type: string, id: string): boolean {
  if (type === 'block') return getBlock(id) !== undefined;
  if (type === 'animal') return getAnimal(id) !== undefined;
  if (type === 'group') return getAnimalGroup(id) !== undefined;
  return getField(id) !== undefined;
}

/** B-12: owner, helper and inspector read the history. */
export const GET: RequestHandler = (event) => {
  requireUser(event);
  const parsed = organicStatusQuerySchema.safeParse(
    Object.fromEntries(event.url.searchParams.entries())
  );
  if (!parsed.success) return invalidBody(parsed.error.issues);
  return json({ entries: listOrganicStatusEntries(parsed.data) });
};

/** Append-only (B-11): a correction is a new entry. Not gated by the
 *  season close-out. */
export const POST: RequestHandler = async (event) => {
  const user = requireUser(event);
  const refused = organicWriteRefusal(user, event.locals?.locale);
  if (refused) return refused;
  let body: unknown;
  try {
    body = await event.request.json();
  } catch {
    return json({ error: 'invalid JSON' }, { status: 400 });
  }
  const parsed = organicStatusCreateSchema.safeParse(body);
  if (!parsed.success) return invalidBody(parsed.error.issues);
  const input = parsed.data;

  if (input.subjectType === 'field') {
    const field = getField(input.subjectId);
    if (!field) return json({ error: 'unknown subjectId' }, { status: 400 });
    if (!isCropBearing(field.kind)) {
      return json(
        {
          error: 'NOT_GROWING_AREA',
          message: t(event.locals?.locale, 'organic.api.notGrowingArea')
        },
        { status: 400 }
      );
    }
  } else if (!subjectExists(input.subjectType, input.subjectId)) {
    return json({ error: 'unknown subjectId' }, { status: 400 });
  }

  const timeZone = farmTimeZone();
  const latest = maxEffectiveDay(todayYmd({ ...DEFAULT_PREFS, timeZone }));
  const [y, m, d] = input.effectiveOn.split('-').map(Number);
  const real = new Date(Date.UTC(y, m - 1, d));
  if (
    real.getUTCFullYear() !== y ||
    real.getUTCMonth() !== m - 1 ||
    real.getUTCDate() !== d ||
    input.effectiveOn < EFFECTIVE_DAY_MIN ||
    input.effectiveOn > latest
  ) {
    return json(
      {
        error: 'invalid request',
        issues: [
          {
            path: 'effectiveOn',
            message: t(event.locals?.locale, 'organic.api.realDate', {
              min: EFFECTIVE_DAY_MIN,
              max: latest
            })
          }
        ]
      },
      { status: 400 }
    );
  }

  if (input.documentId) {
    const docRefused = checkLabReport(input.documentId, event.locals?.locale);
    if (docRefused) return docRefused;
  }

  const entry = db.transaction(() => {
    const saved = insertOrganicStatusEntry({
      subjectType: input.subjectType,
      subjectId: input.subjectId,
      status: input.status,
      effectiveAt: zonedDayStartMs(y, m, d, timeZone),
      certifier: input.certifier?.trim() || null,
      note: input.note?.trim() || null,
      createdBy: user.id
    });
    if (input.documentId) {
      insertDocumentLink({
        documentId: input.documentId,
        subjectType: 'organic-status',
        subjectId: saved.id,
        createdBy: user.id
      });
    }
    return { ...saved, documentIds: input.documentId ? [input.documentId] : [] };
  });
  return json({ entry }, { status: 201 });
};

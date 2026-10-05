import { json, type RequestHandler } from '@sveltejs/kit';
import { t } from '$lib/i18n';
import {
  deleteAnimalIfEmpty,
  getAnimal,
  insertFlagChange,
  listFlagChanges,
  setAnimalFlag,
  getAnimalPhoto,
  setAnimalPhoto,
  setAnimalPhotoDocument,
  updateAnimal,
  type FlagChange
} from '$lib/db/animals';
import { getAnimalGroupSummary } from '$lib/db/animalGroups';
import { listLocationsForSubject, refreshHousingCache } from '$lib/db/animalLocations';
import { animalPatchSchema } from '$lib/animals/apiSchemas';
import { isOutcomeStatus } from '$lib/animals/model';
import { sanitizePhotoDataUrl } from '$lib/journal/photo';
import { requireMutator, requireOwner } from '$lib/server/auth';
import { isInteractiveOwner } from '$lib/server/interactiveOwner';
import { presumeLactating } from '$lib/safety/grazingInterval';
import { getSpecies, parseBody, statusEventsWithLocks, tagWarnings } from '$lib/server/animals';
import { tryGuardedHoldWrite } from '$lib/server/holdGuard';
import { endCareForSubject } from '$lib/server/carePlans';
import {
  animalPhotoTitle,
  discardPhoto,
  storePhoto,
  type StoredPhotoRef
} from '$lib/server/vault/photoWrite';

const notFound = (locale?: string | null) =>
  json({ error: t(locale, 'animallib.api.animalNotFound') }, { status: 404 });

export const GET: RequestHandler = ({ params, locals }) => {
  const animal = params.id ? getAnimal(params.id) : undefined;
  if (!animal) return notFound(locals?.locale);
  return json({
    animal,
    group: animal.groupId ? (getAnimalGroupSummary(animal.groupId) ?? null) : null,
    locations: listLocationsForSubject('animal', animal.id),
    statusEvents: statusEventsWithLocks('animal', animal.id),
    flagChanges: listFlagChanges('animal', animal.id)
  });
};

export const _requestSchema = animalPatchSchema;

/** Helpers may add or replace a photo; everything else is the owner's. An
 *  animal that is no longer here is read-only except notes and photo. */
const HELPER_KEYS = new Set(['photo']);
const GONE_KEYS = new Set(['notes', 'photo']);

export const PATCH: RequestHandler = async (event) => {
  const user = requireMutator(event);
  const animal = event.params.id ? getAnimal(event.params.id) : undefined;
  if (!animal) return notFound(event.locals?.locale);
  const body = await parseBody(event.request, animalPatchSchema, event.locals?.locale);
  if (!body.ok) return body.response;
  const input = body.data;
  const keys = Object.keys(input);

  if (user.role !== 'owner' && keys.some((k) => !HELPER_KEYS.has(k))) {
    return json(
      { error: t(event.locals?.locale, 'api.err.animalOwnerOnly'), code: 'OWNER_ONLY' },
      { status: 403 }
    );
  }
  const gone = isOutcomeStatus(animal.status);
  if (gone && keys.some((k) => !GONE_KEYS.has(k))) {
    return json(
      {
        error: t(event.locals?.locale, 'api.err.animalGone'),
        code: 'READ_ONLY'
      },
      { status: 409 }
    );
  }
  const nextName = input.name !== undefined ? input.name : animal.name;
  const nextTag = input.tag !== undefined ? input.tag : animal.tag;
  if (!nextName?.trim() && !nextTag?.trim()) {
    return json(
      { error: t(event.locals?.locale, 'animals.edit.keepNameOrTag'), code: 'NEEDS_IDENTIFIER' },
      { status: 400 }
    );
  }
  if (input.status === 'archived' && animal.status !== 'active') {
    return json(
      { error: t(event.locals?.locale, 'animallib.api.archiveOnlyHere') },
      { status: 409 }
    );
  }
  if (input.status === 'active' && animal.status !== 'archived' && animal.status !== 'active') {
    return json(
      { error: t(event.locals?.locale, 'animallib.api.useStatus'), code: 'USE_STATUS' },
      { status: 409 }
    );
  }
  const species = await getSpecies(animal.speciesId);
  const speciesProducts = species?.products ?? ['milk'];
  const lactatingBefore = presumeLactating({ speciesProducts, sex: animal.sex });
  const lactatingAfter =
    input.sex === undefined
      ? lactatingBefore
      : presumeLactating({ speciesProducts, sex: input.sex });
  const endsLactating = lactatingBefore && !lactatingAfter;
  if (endsLactating) {
    if (!isInteractiveOwner(event, user)) {
      return json(
        {
          error:
            'Changing this animal to male ends the "may be in milk" reading, which shortens grazing holds. Only the owner, signed in on their own account, can do that.',
          code: 'OWNER_ONLY'
        },
        { status: 403 }
      );
    }
    if (!input.flagReason) {
      return json(
        {
          error:
            'Changing this animal to male shortens grazing holds on its milk and meat. Say why the sex is changing.',
          code: 'REASON_REQUIRED'
        },
        { status: 400 }
      );
    }
  }
  if (input.notForSlaughter !== undefined) {
    if (!species?.notForSlaughterToggle) {
      return json(
        { error: t(event.locals?.locale, 'animallib.api.notOffered'), code: 'NOT_OFFERED' },
        { status: 400 }
      );
    }
  }
  let photo: string | null | undefined;
  if (input.photo !== undefined) {
    if (input.photo === null) {
      photo = null;
    } else {
      const checked = sanitizePhotoDataUrl(input.photo);
      if (!checked.ok) {
        return json(
          {
            error:
              checked.error === 'too-large'
                ? t(event.locals?.locale, 'api.err.photoTooLarge')
                : t(event.locals?.locale, 'api.err.photoJpeg'),
            code: 'BAD_PHOTO'
          },
          { status: 400 }
        );
      }
      photo = checked.dataUrl;
    }
  }

  const before = photo !== undefined ? getAnimalPhoto(animal.id) : null;
  const stored: StoredPhotoRef | null = photo
    ? await storePhoto('animal-photo', photo, {
        title: animalPhotoTitle(animal),
        uploadedBy: user.id
      })
    : null;
  const newDocumentId = stored && 'documentId' in stored ? stored.documentId : null;

  const flagChanges: FlagChange[] = [];
  const guarded = await tryGuardedHoldWrite(event, user, () => {
    const { photo: _photo, foodProducing, notForSlaughter, flagReason, ...rest } = input;
    updateAnimal(animal.id, rest);
    if (rest.status !== undefined && rest.status !== animal.status) {
      refreshHousingCache({ subjectType: 'animal', subjectId: animal.id });
    }
    if (foodProducing !== undefined) {
      const change = setAnimalFlag(
        animal.id,
        'food_producing',
        foodProducing,
        flagReason!,
        user.id
      );
      if (change) flagChanges.push(change);
    }
    if (notForSlaughter !== undefined) {
      const change = setAnimalFlag(
        animal.id,
        'not_for_slaughter',
        notForSlaughter,
        flagReason!,
        user.id
      );
      if (change) flagChanges.push(change);
    }
    if (newDocumentId) setAnimalPhotoDocument(animal.id, newDocumentId);
    else if (photo !== undefined) {
      setAnimalPhoto(animal.id, stored && 'inline' in stored ? stored.inline : null);
    }
    if (lactatingBefore !== lactatingAfter) {
      flagChanges.push(
        insertFlagChange({
          subjectType: 'animal',
          subjectId: animal.id,
          flag: 'presumed_lactating',
          oldValue: lactatingBefore,
          newValue: lactatingAfter,
          reason: flagReason ?? `Sex changed to ${input.sex}`,
          changedBy: user.id
        })
      );
    }
  });
  if (!guarded.ok) {
    await discardPhoto(newDocumentId, user.id);
    return guarded.response;
  }
  if (before && 'documentId' in before && before.documentId !== newDocumentId) {
    await discardPhoto(before.documentId, user.id);
  }
  if (input.status === 'archived') endCareForSubject('animal', animal.id);

  return json({
    animal: getAnimal(animal.id),
    flagChanges,
    warnings: input.tag !== undefined ? tagWarnings(input.tag, animal.id, event.locals?.locale) : []
  });
};

/** Deletes a mistaken entry. Anything with a record is archived instead. */
export const DELETE: RequestHandler = async (event) => {
  const user = requireOwner(event);
  const id = event.params.id;
  if (!id) return notFound(event.locals?.locale);
  const before = getAnimalPhoto(id);
  const guarded = await tryGuardedHoldWrite(event, user, () => deleteAnimalIfEmpty(id));
  if (!guarded.ok) return guarded.response;
  const outcome = guarded.value;
  if (outcome === 'deleted' && before && 'documentId' in before) {
    await discardPhoto(before.documentId, user.id);
  }
  if (outcome === 'not-found') return notFound(event.locals?.locale);
  if (outcome === 'has-records') {
    return json(
      { error: t(event.locals?.locale, 'api.err.animalHasRecords'), code: 'ANIMAL_HAS_RECORDS' },
      { status: 409 }
    );
  }
  return json({ ok: true });
};

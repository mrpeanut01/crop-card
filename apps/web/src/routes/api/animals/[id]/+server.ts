import { json, type RequestHandler } from '@sveltejs/kit';
import { db } from '$lib/db/client';
import {
  deleteAnimalIfEmpty,
  getAnimal,
  listFlagChanges,
  setAnimalFlag,
  setAnimalPhoto,
  updateAnimal,
  type FlagChange
} from '$lib/db/animals';
import { getAnimalGroupSummary } from '$lib/db/animalGroups';
import { listLocationsForSubject, refreshHousingCache } from '$lib/db/animalLocations';
import { animalPatchSchema } from '$lib/animals/apiSchemas';
import { isOutcomeStatus } from '$lib/animals/model';
import { sanitizePhotoDataUrl } from '$lib/journal/photo';
import { requireMutator, requireOwner } from '$lib/server/auth';
import { getSpecies, parseBody, statusEventsWithLocks, tagWarnings } from '$lib/server/animals';

const notFound = () => json({ error: 'animal not found' }, { status: 404 });

export const GET: RequestHandler = ({ params }) => {
  const animal = params.id ? getAnimal(params.id) : undefined;
  if (!animal) return notFound();
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
  if (!animal) return notFound();
  const body = await parseBody(event.request, animalPatchSchema);
  if (!body.ok) return body.response;
  const input = body.data;
  const keys = Object.keys(input);

  if (user.role !== 'owner' && keys.some((k) => !HELPER_KEYS.has(k))) {
    return json(
      { error: 'Only the owner can change this. Helpers can add a photo.', code: 'OWNER_ONLY' },
      { status: 403 }
    );
  }
  const gone = isOutcomeStatus(animal.status) || animal.status === 'slaughtered';
  if (gone && keys.some((k) => !GONE_KEYS.has(k))) {
    return json(
      {
        error: 'This animal is no longer here. Only notes and the photo can change.',
        code: 'READ_ONLY'
      },
      { status: 409 }
    );
  }
  const nextName = input.name !== undefined ? input.name : animal.name;
  const nextTag = input.tag !== undefined ? input.tag : animal.tag;
  if (!nextName?.trim() && !nextTag?.trim()) {
    return json({ error: 'Keep a name or a tag.', code: 'NEEDS_IDENTIFIER' }, { status: 400 });
  }
  if (input.status === 'archived' && animal.status !== 'active') {
    return json({ error: 'Only an animal that is here can be archived.' }, { status: 409 });
  }
  if (input.status === 'active' && animal.status !== 'archived' && animal.status !== 'active') {
    return json(
      { error: 'Record a status change to bring this animal back.', code: 'USE_STATUS' },
      { status: 409 }
    );
  }
  if (input.notForSlaughter !== undefined) {
    const species = await getSpecies(animal.speciesId);
    if (!species?.notForSlaughterToggle) {
      return json(
        { error: 'This species has no "not for slaughter" setting.', code: 'NOT_OFFERED' },
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
                ? 'The photo is too large. It must be a JPEG under 300 KB.'
                : 'The photo must be a JPEG.',
            code: 'BAD_PHOTO'
          },
          { status: 400 }
        );
      }
      photo = checked.dataUrl;
    }
  }

  const flagChanges: FlagChange[] = [];
  db.transaction(() => {
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
    if (photo !== undefined) setAnimalPhoto(animal.id, photo);
  });

  return json({
    animal: getAnimal(animal.id),
    flagChanges,
    warnings: input.tag !== undefined ? tagWarnings(input.tag, animal.id) : []
  });
};

/** Deletes a mistaken entry. Anything with a record is archived instead. */
export const DELETE: RequestHandler = (event) => {
  requireOwner(event);
  const id = event.params.id;
  if (!id) return notFound();
  const outcome = deleteAnimalIfEmpty(id);
  if (outcome === 'not-found') return notFound();
  if (outcome === 'has-records') {
    return json(
      { error: 'This animal has records. Archive it instead.', code: 'ANIMAL_HAS_RECORDS' },
      { status: 409 }
    );
  }
  return json({ ok: true });
};

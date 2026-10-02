import { json, type RequestHandler } from '@sveltejs/kit';
import { t } from '$lib/i18n';
import { listFlagChanges, listGroupMembers, type FlagChange } from '$lib/db/animals';
import {
  activeMemberCount,
  deleteGroupIfEmpty,
  getAnimalGroup,
  getAnimalGroupSummary,
  setGroupFoodProducing,
  setGroupHeadCount,
  updateAnimalGroup
} from '$lib/db/animalGroups';
import { listLocationsForSubject } from '$lib/db/animalLocations';
import { insertStatusEvent } from '$lib/db/animalStatus';
import { animalGroupPatchSchema } from '$lib/animals/apiSchemas';
import { requireOwner } from '$lib/server/auth';
import { parseBody, statusEventsWithLocks } from '$lib/server/animals';
import { tryGuardedHoldWrite } from '$lib/server/holdGuard';
import { endCareForSubject } from '$lib/server/carePlans';
import { groupAdditionGate } from '$lib/server/grazingGate';
import { farmTimeZone } from '$lib/db/userProfile';

const notFound = (locale?: string | null) =>
  json({ error: t(locale, 'animallib.api.groupNotFound') }, { status: 404 });

export const GET: RequestHandler = ({ params, locals }) => {
  const group = params.id ? getAnimalGroupSummary(params.id) : undefined;
  if (!group) return notFound(locals?.locale);
  return json({
    group,
    members: listGroupMembers(group.id),
    locations: listLocationsForSubject('group', group.id),
    statusEvents: statusEventsWithLocks('group', group.id),
    flagChanges: listFlagChanges('group', group.id)
  });
};

export const _requestSchema = animalGroupPatchSchema;

/** Owner only. A head count increase (a hatch or a purchase) writes an
 *  `active` status event with the difference. A decrease is a loss and must
 *  go through `POST /api/animals/status` with an outcome (B-09). */
export const PATCH: RequestHandler = async (event) => {
  const user = requireOwner(event);
  const group = event.params.id ? getAnimalGroup(event.params.id) : undefined;
  if (!group) return notFound(event.locals?.locale);
  const body = await parseBody(event.request, animalGroupPatchSchema);
  if (!body.ok) return body.response;
  const input = body.data;
  if (input.status === 'archived' && group.status === 'active' && activeMemberCount(group.id) > 0) {
    return json(
      {
        error: t(event.locals?.locale, 'animallib.api.namedBeforeArchive'),
        code: 'GROUP_HAS_MEMBERS'
      },
      { status: 409 }
    );
  }
  if (input.status === 'archived' && group.status === 'active' && group.headCount > 0) {
    return json(
      {
        error: t(event.locals?.locale, 'animallib.api.unnamedBeforeArchive', {
          count: group.headCount
        }),
        code: 'GROUP_HAS_ANIMALS'
      },
      { status: 409 }
    );
  }
  if (input.headCount !== undefined && input.headCount < group.headCount) {
    return json(
      {
        error: t(event.locals?.locale, 'animals.group.lowerCount'),
        code: 'USE_STATUS_FOR_LOSSES'
      },
      { status: 409 }
    );
  }
  if (input.headCount !== undefined && group.status !== 'active' && input.status !== 'active') {
    return json(
      { error: t(event.locals?.locale, 'animallib.api.restoreBeforeCount') },
      { status: 409 }
    );
  }

  let grazingWarnings: string[] = [];
  if (input.headCount !== undefined && input.headCount > group.headCount) {
    const gate = await groupAdditionGate(group.id, Date.now(), user.role, farmTimeZone());
    if (!gate.ok) return json(gate.body, { status: gate.status });
    grazingWarnings = gate.warnings;
  }

  const flagChanges: FlagChange[] = [];
  const guarded = await tryGuardedHoldWrite(event, user, () => {
    const { headCount, countReason, foodProducing, flagReason, ...rest } = input;
    updateAnimalGroup(group.id, rest);
    if (headCount !== undefined && headCount !== group.headCount) {
      insertStatusEvent({
        subjectType: 'group',
        subjectId: group.id,
        status: 'active',
        occurredAt: Date.now(),
        reason: countReason?.trim() || 'Count corrected',
        headCountDelta: headCount - group.headCount,
        recordedById: user.id
      });
      setGroupHeadCount(group.id, headCount);
    }
    if (foodProducing !== undefined) {
      const change = setGroupFoodProducing(group.id, foodProducing, flagReason!, user.id);
      if (change) flagChanges.push(change);
    }
  });
  if (!guarded.ok) return guarded.response;
  if (input.status === 'archived') endCareForSubject('group', group.id);
  return json({ group: getAnimalGroupSummary(group.id), flagChanges, grazingWarnings });
};

/** Deletes a mistaken group with no members and no records. */
export const DELETE: RequestHandler = async (event) => {
  const user = requireOwner(event);
  const id = event.params.id;
  if (!id) return notFound(event.locals?.locale);
  const guarded = await tryGuardedHoldWrite(event, user, () => deleteGroupIfEmpty(id));
  if (!guarded.ok) return guarded.response;
  const outcome = guarded.value;
  if (outcome === 'not-found') return notFound(event.locals?.locale);
  if (outcome === 'has-members') {
    return json(
      { error: 'This group still has named animals.', code: 'GROUP_HAS_MEMBERS' },
      { status: 409 }
    );
  }
  if (outcome === 'has-records') {
    return json(
      { error: 'This group has records. Archive it instead.', code: 'ANIMAL_HAS_RECORDS' },
      { status: 409 }
    );
  }
  return json({ ok: true });
};

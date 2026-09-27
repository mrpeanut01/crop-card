import { json, type RequestHandler } from '@sveltejs/kit';
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

const notFound = () => json({ error: 'group not found' }, { status: 404 });

export const GET: RequestHandler = ({ params }) => {
  const group = params.id ? getAnimalGroupSummary(params.id) : undefined;
  if (!group) return notFound();
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
  if (!group) return notFound();
  const body = await parseBody(event.request, animalGroupPatchSchema);
  if (!body.ok) return body.response;
  const input = body.data;
  if (input.status === 'archived' && group.status === 'active' && activeMemberCount(group.id) > 0) {
    return json(
      {
        error: 'Move or record the named animals in this group before archiving it.',
        code: 'GROUP_HAS_MEMBERS'
      },
      { status: 409 }
    );
  }
  if (input.status === 'archived' && group.status === 'active' && group.headCount > 0) {
    return json(
      {
        error: `${group.headCount} unnamed animals are still in this group. Record them as gone or move them before archiving it.`,
        code: 'GROUP_HAS_ANIMALS'
      },
      { status: 409 }
    );
  }
  if (input.headCount !== undefined && input.headCount < group.headCount) {
    return json(
      {
        error: 'A lower count is a loss. Record it with "Record a change" so the reason is kept.',
        code: 'USE_STATUS_FOR_LOSSES'
      },
      { status: 409 }
    );
  }
  if (input.headCount !== undefined && group.status !== 'active' && input.status !== 'active') {
    return json({ error: 'Restore this group before changing its count.' }, { status: 409 });
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
  return json({ group: getAnimalGroupSummary(group.id), flagChanges });
};

/** Deletes a mistaken group with no members and no records. */
export const DELETE: RequestHandler = async (event) => {
  const user = requireOwner(event);
  const id = event.params.id;
  if (!id) return notFound();
  const guarded = await tryGuardedHoldWrite(event, user, () => deleteGroupIfEmpty(id));
  if (!guarded.ok) return guarded.response;
  const outcome = guarded.value;
  if (outcome === 'not-found') return notFound();
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

import { json, type RequestHandler } from '@sveltejs/kit';
import { disbandGroup, listGroupMembers } from '$lib/db/crops';
import { requireOwner } from '$lib/server/auth';
import { t } from '$lib/i18n';

export const GET: RequestHandler = async (event) => {
  requireOwner(event);
  const groupId = event.params.groupId;
  if (!groupId)
    return json({ error: t(event.locals?.locale, 'api.errB.missingGroupId') }, { status: 400 });
  const members = listGroupMembers(groupId);
  if (members.length === 0)
    return json({ error: t(event.locals?.locale, 'api.errB.unknownGroup') }, { status: 404 });
  return json({ groupId, members });
};

export const DELETE: RequestHandler = async (event) => {
  requireOwner(event);
  const groupId = event.params.groupId;
  if (!groupId)
    return json({ error: t(event.locals?.locale, 'api.errB.missingGroupId') }, { status: 400 });
  const cleared = disbandGroup(groupId);
  if (cleared === 0)
    return json({ error: t(event.locals?.locale, 'api.errB.unknownGroup') }, { status: 404 });
  return json({ groupId, disbanded: cleared });
};

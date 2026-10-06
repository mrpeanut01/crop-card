/**
 * GET /api/orchard/audiences
 *
 * Every Area whose orchard calendar guide the owner chose (OP-4), with its
 * name, so Season Setup can show the choices again each season. Owner
 * only. Areas that no longer exist are left out.
 */

import { json, type RequestHandler } from '@sveltejs/kit';
import { getField } from '$lib/db/fields';
import { listAudienceOverrides } from '$lib/db/orchardCalendar';
import { requireOwner } from '$lib/server/auth';

export const GET: RequestHandler = (event) => {
  requireOwner(event);
  const areas = [...listAudienceOverrides()]
    .map(([areaId, audience]) => {
      const area = getField(areaId);
      return area ? { areaId, areaName: area.name, audience } : null;
    })
    .filter((a) => a !== null)
    .sort((a, b) => a.areaName.localeCompare(b.areaName));
  return json({ areas });
};

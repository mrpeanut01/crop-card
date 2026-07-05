/**
 * Phase 25c (#88) — /settings/records loader.
 *
 * Records retention policy + bulk-export landing. Retention defaults
 * to the FR-07 / VDACS standard (2-year minimum for spray records).
 * Bulk exports (CSV / PDF / USDA) live at /api/spray/records/export.*
 * already; this page surfaces the menu + counts.
 */

import { error, redirect, type ServerLoad } from '@sveltejs/kit';
import { listSprayEvents, recordsApproachingRetention, LOCK_WINDOW_MS } from '$lib/db/sprayEvents';
import { listInsecticideEvents } from '$lib/db/insecticideEvents';
import { listFungicideEvents } from '$lib/db/fungicideEvents';
import { listHarvestEvents } from '$lib/db/harvestEvents';

const SPRAY_RETENTION_YEARS = 2;
const DAY_MS = 86_400_000;

export const load: ServerLoad = ({ locals }) => {
  if (!locals.user) throw redirect(303, '/');
  if (locals.user.role !== 'owner') throw error(403, 'owner-only');

  const sprays = listSprayEvents();
  const insects = listInsecticideEvents();
  const fungs = listFungicideEvents();
  const harvests = listHarvestEvents();

  const now = Date.now();
  const retentionCutoffMs = now - SPRAY_RETENTION_YEARS * 365 * DAY_MS;
  const sprayInRetention = sprays.filter((s) => s.occurredAt >= retentionCutoffMs).length;
  const sprayOlder = sprays.length - sprayInRetention;
  const approachingRetention = recordsApproachingRetention(now).length;

  return {
    counts: {
      sprays: sprays.length,
      insecticides: insects.length,
      fungicides: fungs.length,
      harvests: harvests.length
    },
    retention: {
      sprayYears: SPRAY_RETENTION_YEARS,
      sprayInRetention,
      sprayOlder,
      approachingRetention
    },
    lockWindowHours: LOCK_WINDOW_MS / (60 * 60 * 1000)
  };
};

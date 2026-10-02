/**
 * GET /api/animals/treatments.csv?from=YYYY-MM-DD&to=YYYY-MM-DD
 *
 * 33B (B-50): the animal treatment log, one header row and one row per
 * dose (B-44: no preamble, so it opens in a spreadsheet as is). Owner and
 * inspector (B-48).
 */

import type { RequestHandler } from '@sveltejs/kit';
import { prefsFor } from '$lib/db/userProfile';
import { buildTreatmentLog } from '$lib/records/animalTreatmentLog.server';
import { treatmentLogCsv } from '$lib/records/animalTreatmentLog';
import { exportWindowQuerySchema } from '$lib/records/apiSchemas';
import { recordExportReader } from '$lib/records/exportAccess.server';
import { parseExportWindow, windowRefusal } from '$lib/records/exportWindow';

export const _requestSchema = exportWindowQuerySchema;

export const GET: RequestHandler = async (event) => {
  const access = recordExportReader(event);
  if (!access.ok) return access.response;
  const prefs = prefsFor(access.user.id);
  const window = parseExportWindow(event.url.searchParams, prefs);
  if (!window.ok) return windowRefusal(window);
  const rows = await buildTreatmentLog(window, prefs);
  return new Response(treatmentLogCsv(rows, { preamble: false }), {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="cropcard-animal-treatments-${window.from}-to-${window.to}.csv"`,
      'Cache-Control': 'private, no-store'
    }
  });
};

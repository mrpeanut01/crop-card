/**
 * GET /api/animals/treatments.pdf?from=YYYY-MM-DD&to=YYYY-MM-DD
 *
 * 33B (B-50): the animal treatment log as a PDF, the same rows as the CSV.
 * Every page's footer reads "Prepared from records kept in CropCard."
 * (B-44). Owner and inspector (B-48).
 */

import type { RequestHandler } from '@sveltejs/kit';
import { prefsFor } from '$lib/db/userProfile';
import { buildTreatmentLog } from '$lib/records/animalTreatmentLog.server';
import { exportWindowQuerySchema } from '$lib/records/apiSchemas';
import { recordExportReader } from '$lib/records/exportAccess.server';
import { parseExportWindow, windowRefusal } from '$lib/records/exportWindow';
import { treatmentLogPdf } from '$lib/records/treatmentLogPdf.server';
import { farmNameOf } from '$lib/records/farmName.server';

export const _requestSchema = exportWindowQuerySchema;

export const GET: RequestHandler = async (event) => {
  const access = recordExportReader(event);
  if (!access.ok) return access.response;
  const prefs = prefsFor(access.user.id);
  const window = parseExportWindow(event.url.searchParams, prefs);
  if (!window.ok) return windowRefusal(window);
  const rows = await buildTreatmentLog(window, prefs);
  const pdf = await treatmentLogPdf(rows, {
    farmName: farmNameOf(access.user.activeOwnerId),
    from: window.from,
    to: window.to,
    footer: 'log',
    viewer: access.user,
    prefs
  });
  return new Response(new Uint8Array(pdf), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="cropcard-animal-treatments-${window.from}-to-${window.to}.pdf"`,
      'Cache-Control': 'private, no-store'
    }
  });
};

/**
 * GET /api/records/year-summary.pdf?year=YYYY
 *
 * UC-46 — Year-end summary report as a compliance-ready PDF.
 *
 * Reuses the same server-side pdfmake pipeline as the spray-record export
 * (no headless browser). Renders the deterministic aggregate produced by
 * `buildYearSummary`: totals, acres treated by product + chemistry class,
 * philosophy roll-up, harvest totals by archetype (incl. moisture
 * min/max/mean), input costs, scout→spray funnel, and decon/calibration
 * compliance. Read-only — no writes, no migration.
 *
 * Deterministic-first (Invariant 7): this endpoint never calls Claude. The
 * tables are the product; an AI narrative would be optional enrichment.
 */

import { type RequestEvent, type RequestHandler } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';

import { requireUser } from '$lib/server/auth';
import { db } from '$lib/db/client';
import { owners } from '$lib/db/schema';
import { unscopedQueryNote } from '$lib/db/tenant';
import { APP_VERSION } from '$lib/version';
import { buildYearSummary } from '$lib/records/yearSummary.server';
import { PHILOSOPHY_LABELS } from '$lib/season/setup';
import { identityLabel } from '$lib/identity';
import { prefsFor } from '$lib/db/userProfile';
import { todayYmd } from '$lib/prefs';
import { renderPdf } from '$lib/server/pdf';
import { yearSummaryDoc } from '$lib/server/render/docs/yearSummary';
import { withRenderRefusal } from '$lib/server/render/refusal';

function ownerNameOf(ownerId: string | null): string {
  if (!ownerId) return '(unknown farm)';
  unscopedQueryNote('year-summary PDF footer looks up the active Owner row for display');
  const row = db.select({ name: owners.name }).from(owners).where(eq(owners.id, ownerId)).get();
  return row?.name ?? '(unknown farm)';
}

export const GET: RequestHandler = (event) => withRenderRefusal(event, () => exportPdf(event));

async function exportPdf(event: RequestEvent): Promise<Response> {
  const user = requireUser(event);
  const prefs = prefsFor(user.id);
  const now = new Date();
  const today = todayYmd(prefs, now);
  const yearParam = event.url.searchParams.get('year');
  const year =
    yearParam && /^\d{4}$/.test(yearParam) ? Number(yearParam) : Number(today.slice(0, 4));

  const summary = await buildYearSummary(year, user.activeOwnerId, undefined, {
    includeCosts: user.role === 'owner'
  });

  const spec = yearSummaryDoc({
    year,
    farmName: ownerNameOf(user.activeOwnerId),
    today,
    exporter: identityLabel(user),
    now,
    prefs,
    summary,
    philosophyLabel: PHILOSOPHY_LABELS[summary.philosophy.philosophy]
  });
  const buffer = await renderPdf(spec, {
    ownerId: user.activeOwnerId ?? '',
    signal: event.request?.signal
  });

  return new Response(new Uint8Array(buffer), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="cropcard-year-summary-${year}.pdf"`,
      'X-CropCard-Generator': `CropCard/${APP_VERSION}`,
      'X-CropCard-Exported-By': identityLabel(user)
    }
  });
}

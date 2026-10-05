import { t } from '$lib/i18n';
import { json, type RequestHandler } from '@sveltejs/kit';
import { grazingAttestationSchema } from '$lib/animals/recordApiSchemas';
import { insertGrazingAttestation } from '$lib/db/grazingAttestations';
import { requireOwner } from '$lib/server/auth';
import { assertField, rejectForeignRefs } from '$lib/server/foreignRefs';
import { parseBody } from '$lib/server/animals';
import { tryGuardedHoldWrite } from '$lib/server/holdGuard';
import { interactiveOwnerRefusal, isInteractiveOwner } from '$lib/server/interactiveOwner';
import { applicationsOnField, loadGrazingContext } from '$lib/server/areaGrazing';
import type { GrazingApplication } from '$lib/safety/grazingInterval';

export const _requestSchema = grazingAttestationSchema;

function refusal(code: string, error: string, status = 409): Response {
  return json({ error, code }, { status });
}

/**
 * Owner only, signed in (Q11, C-32): not an API token or an impersonation. Records the grazing and haying intervals read
 * from a product's label for applications on one Area, which lift a
 * `GRAZING_UNKNOWN` block for exactly those applications (C-27). One row
 * per application and product, saved together with `manual` provenance and
 * the owner's reason; rows are never edited or deleted. A label that
 * forbids pasture use is never cleared this way (C-24), and a number below
 * a label value on file never shortens a hold (the kernel keeps the floor).
 */
export const POST: RequestHandler = async (event) => {
  const user = requireOwner(event);
  if (!isInteractiveOwner(event, user)) return interactiveOwnerRefusal();
  const body = await parseBody(event.request, grazingAttestationSchema, event.locals?.locale);
  if (!body.ok) return body.response;
  const input = body.data;
  const foreign = rejectForeignRefs(assertField('fieldId', input.fieldId));
  if (foreign) return foreign;

  const context = await loadGrazingContext();
  const byRef = new Map<string, GrazingApplication[]>();
  // A deleted block's applications still count on its Area (review round 5).
  for (const a of applicationsOnField(context.applications, input.fieldId)) {
    const list = byRef.get(a.ref) ?? [];
    list.push(a);
    byRef.set(a.ref, list);
  }

  const rows: Array<{
    sprayEventRef: string;
    productPluginId: string | null;
    grazeDays: number | null;
    hayDays: number | null;
    lactatingGrazeDays: number | null;
    meatRemovalDays: number | null;
  }> = [];
  for (const item of input.items) {
    const apps = byRef.get(item.sprayEventRef) ?? [];
    if (apps.length === 0) {
      return refusal(
        'UNKNOWN_APPLICATION',
        t(event.locals?.locale, 'api.err.attestUnknownApplication'),
        400
      );
    }
    let app: GrazingApplication | undefined;
    if (item.productPluginId) {
      app = apps.find((a) => a.productPluginId === item.productPluginId);
    } else if (apps.length === 1) {
      app = apps[0];
    }
    if (!app) {
      return refusal(
        'PRODUCT_REQUIRED',
        t(event.locals?.locale, 'api.err.attestProductRequired'),
        400
      );
    }
    if (app.restrictions?.notForPasture === true) {
      return refusal(
        'LABEL_FORBIDS_GRAZING',
        `The label for ${app.productName} forbids grazing or haying treated areas, so no interval can clear it.`
      );
    }
    rows.push({
      sprayEventRef: item.sprayEventRef,
      productPluginId: app.productPluginId,
      grazeDays: item.grazeDays ?? null,
      hayDays: item.hayDays ?? null,
      lactatingGrazeDays: item.lactatingGrazeDays ?? null,
      meatRemovalDays: item.meatRemovalDays ?? null
    });
  }

  const guarded = await tryGuardedHoldWrite(
    event,
    user,
    () =>
      rows.map((r) =>
        insertGrazingAttestation({
          ...r,
          fieldId: input.fieldId,
          reason: input.reason,
          attestedBy: user.id
        })
      ),
    { resolvesUnknown: true }
  );
  if (!guarded.ok) return guarded.response;
  return json({ attestations: guarded.value }, { status: 201 });
};

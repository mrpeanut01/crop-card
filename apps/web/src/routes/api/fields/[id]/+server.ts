import { t } from '$lib/i18n';
/**
 * GET    /api/fields/:id  — fetch one field
 * PATCH  /api/fields/:id  — edit name/acres/location/notes/geometry/kind/details
 * DELETE /api/fields/:id  — cascade through every block + crop + event
 */

import { error, json, type RequestHandler } from '@sveltejs/kit';
import { deleteFieldCascade } from '$lib/db/admin';
import { fieldHoldsGroupHistory, housedSubjectCount } from '$lib/db/animalLocations';
import { getField, updateField } from '$lib/db/fields';
import { withSketchAcres } from '$lib/farm/sketch';
import { fieldPatchSchema } from '$lib/farm/apiSchemas';
import { isDesignable, validateAreaDetails } from '$lib/farm/areaKinds';
import { isHousingAreaKind } from '$lib/animals/model';
import { bedsPastAreaEdge } from '$lib/server/garden/bedLayout';
import { requireOwner } from '$lib/server/auth';
import { listBlocks } from '$lib/db/blocks';
import { farmTimeZone } from '$lib/db/userProfile';
import { blocksDeleteRefusal } from '$lib/server/areaGrazing';
import { tryGuardedHoldWrite } from '$lib/server/holdGuard';

export const GET: RequestHandler = ({ params, locals }) => {
  if (!params.id) throw error(400, t(locals?.locale, 'stockui.api.idRequired'));
  const field = getField(params.id);
  if (!field) throw error(404, t(locals?.locale, 'api.err.fieldNotFound'));
  return json({ field });
};

export const _requestSchema = fieldPatchSchema;

export const PATCH: RequestHandler = async (event) => {
  if (!event.params.id) throw error(400, t(event.locals?.locale, 'stockui.api.idRequired'));
  const user = requireOwner(event);
  if (!getField(event.params.id))
    throw error(404, t(event.locals?.locale, 'api.err.fieldNotFound'));

  let body: unknown;
  try {
    body = await event.request.json();
  } catch {
    return json({ error: t(event.locals?.locale, 'stockui.api.invalidJson') }, { status: 400 });
  }
  // Read after the body arrives, so a slow request does not act on an
  // Area kind another write has since changed.
  const existing = getField(event.params.id);
  if (!existing) throw error(404, t(event.locals?.locale, 'api.err.fieldNotFound'));
  const parsed = fieldPatchSchema.safeParse(body);
  if (!parsed.success) {
    return json(
      { error: t(event.locals?.locale, 'stockui.api.invalidRequest'), issues: parsed.error.issues },
      { status: 400 }
    );
  }
  const nextKind = parsed.data.kind ?? existing.kind;
  if (
    nextKind !== existing.kind &&
    !isHousingAreaKind(nextKind) &&
    housedSubjectCount(existing.id) > 0
  ) {
    return json(
      {
        error: t(event.locals?.locale, 'api.err.animalsOnAreaKind'),
        code: 'AREA_HAS_ANIMALS'
      },
      { status: 409 }
    );
  }
  const reshapes =
    parsed.data.widthFt !== undefined ||
    parsed.data.lengthFt !== undefined ||
    parsed.data.geometryGeojson !== undefined ||
    (parsed.data.kind !== undefined && parsed.data.kind !== existing.kind);
  if (reshapes && (isDesignable(existing.kind) || isDesignable(nextKind))) {
    const pick = <T>(next: T | null | undefined, prev: T | null | undefined): T | null =>
      next === undefined ? (prev ?? null) : next;
    const problem = bedsPastAreaEdge(
      {
        id: existing.id,
        name: parsed.data.name ?? existing.name,
        kind: nextKind,
        widthFt: pick(parsed.data.widthFt, existing.widthFt),
        lengthFt: pick(parsed.data.lengthFt, existing.lengthFt),
        geometryGeojson: pick(parsed.data.geometryGeojson, existing.geometryGeojson)
      },
      event.locals?.locale
    );
    if (problem) return json(problem, { status: 409 });
  }
  const { details: rawDetails, ...rest } = parsed.data;
  let details;
  if (rawDetails !== undefined) {
    const checked = validateAreaDetails(rest.kind ?? existing.kind, rawDetails);
    if (!checked.ok) {
      return json(
        { error: t(event.locals?.locale, 'api.err.invalidDetailsForKind'), issues: checked.issues },
        { status: 400 }
      );
    }
    details = checked.details;
  }
  const id = event.params.id;
  const patch = { ...withSketchAcres(rest), details };
  const write = () => updateField(id, patch);
  if (parsed.data.kind === undefined) return json({ field: write() });
  // A pasture that turns into a garden or crop field stops counting as
  // grazing land, so its sprays' grazing and hay holds must not shorten.
  // Any write that carries a kind goes through the guard, even one that
  // looks unchanged here: the guard compares against the kind on file
  // inside its own transaction, not a copy read before an await.
  const guarded = await tryGuardedHoldWrite(event, user, write);
  if (!guarded.ok) return guarded.response;
  return json({ field: guarded.value });
};

export const DELETE: RequestHandler = async (event) => {
  if (!event.params.id) throw error(400, t(event.locals?.locale, 'stockui.api.idRequired'));
  const user = requireOwner(event);
  if (!getField(event.params.id))
    throw error(404, t(event.locals?.locale, 'api.err.fieldNotFound'));
  const fieldId = event.params.id;
  const held = await blocksDeleteRefusal(
    fieldId,
    listBlocks({ plantings: 'none' })
      .filter((b) => b.fieldId === fieldId)
      .map((b) => b.id),
    farmTimeZone(),
    Date.now(),
    { wholeArea: true }
  );
  if (held) return json(held, { status: 409 });
  if (housedSubjectCount(event.params.id) > 0) {
    return json(
      {
        error: t(event.locals?.locale, 'api.err.animalsOnAreaDelete'),
        code: 'AREA_HAS_ANIMALS'
      },
      { status: 409 }
    );
  }
  if (fieldHoldsGroupHistory(event.params.id)) {
    return json(
      {
        error: t(event.locals?.locale, 'api.err.areaHasLineage'),
        code: 'AREA_HAS_GROUP_HISTORY'
      },
      { status: 409 }
    );
  }
  const guarded = await tryGuardedHoldWrite(event, user, () => deleteFieldCascade(fieldId));
  if (!guarded.ok) return guarded.response;
  return json(guarded.value);
};

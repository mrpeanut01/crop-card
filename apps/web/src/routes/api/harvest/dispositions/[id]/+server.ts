/**
 * PATCH  /api/harvest/dispositions/:id: change one inside its 48-hour lock
 *        (owner or helper), or set the ledger link at any time (owner).
 * DELETE /api/harvest/dispositions/:id?force=true&reason=: remove one. After
 *        the lock only the owner can, with a reason, and a tombstone stays.
 *
 * Phase 33B (B-29, B-31). Online only; the offline queue sends only POST.
 */

import { json, type RequestHandler } from '@sveltejs/kit';
import { db } from '$lib/db/client';
import {
  DISPOSITION_FORCE_REASON_MAX,
  DISPOSITION_FORCE_REASON_MIN,
  dispositionPatchSchema,
  dispositionIssueText,
  dispositionProblem,
  type HarvestDispositionKind
} from '$lib/harvest/apiSchemas';
import { dispositionDateProblem } from '$lib/harvest/dispositions';
import { getHarvestEvent } from '$lib/db/harvestEvents';
import {
  evaluateDispositionLock,
  getHarvestDisposition,
  setDispositionLedgerEntry,
  updateHarvestDisposition,
  type DispositionFieldChanges
} from '$lib/db/harvestDispositions';
import { deleteHarvestDisposition } from '$lib/db/admin';
import { farmTimeZone, prefsFor } from '$lib/db/userProfile';
import { currentUser } from '$lib/server/auth';
import { canMutate } from '$lib/server/session';
import { checkSeasonClosed } from '$lib/server/seasonClose';
import { assertLedgerEntry, rejectForeignRefs } from '$lib/server/foreignRefs';
import { farmHasOrganicStatus } from '$lib/harvest/organicAtHarvest.server';
import { dispositionNotices, presentDisposition, problem } from '$lib/server/harvestDispositions';
import { t } from '$lib/i18n';

export const _requestSchema = dispositionPatchSchema;

export const PATCH: RequestHandler = async (event) => {
  const user = currentUser(event);
  if (!user) return problem(401, 'UNAUTHENTICATED', 'Sign in to change this record.');
  if (!canMutate(user.role)) {
    return problem(403, 'READ_ONLY', t(event.locals.locale, 'harvestui.disp.err.readOnlyChange'));
  }
  let body: unknown;
  try {
    body = await event.request.json();
  } catch {
    return problem(400, 'INVALID_BODY', 'The request body is not JSON.');
  }
  const parsed = dispositionPatchSchema.safeParse(body);
  if (!parsed.success) {
    return json(
      {
        error: 'INVALID_BODY',
        message: dispositionIssueText(parsed.error.issues, event.locals?.locale),
        issues: parsed.error.issues
      },
      { status: 400 }
    );
  }
  const existing = getHarvestDisposition(event.params.id ?? '');
  if (!existing)
    return problem(404, 'NOT_FOUND', t(event.locals.locale, 'harvestui.disp.err.noRecord'));
  const harvest = getHarvestEvent(existing.harvestEventId);
  if (!harvest)
    return problem(404, 'NOT_FOUND', t(event.locals.locale, 'harvestui.disp.err.noHarvest'));

  const { ledgerEntryId, ...fields } = parsed.data;
  const linking = ledgerEntryId !== undefined;
  if (linking) {
    if (user.role !== 'owner') {
      return problem(403, 'OWNER_ONLY', t(event.locals.locale, 'harvestui.disp.err.ownerLink'));
    }
    if (user.impersonating) {
      return problem(
        403,
        'NOT_WHILE_IMPERSONATING',
        t(event.locals.locale, 'harvestui.disp.err.moneyImpersonating')
      );
    }
    const foreign = rejectForeignRefs(assertLedgerEntry('ledgerEntryId', ledgerEntryId));
    if (foreign) return foreign;
  }

  const changing = Object.keys(fields).length > 0;
  const changes: DispositionFieldChanges = {};
  if (changing) {
    if (evaluateDispositionLock(existing) !== undefined) {
      return problem(409, 'RECORD_LOCKED', t(event.locals.locale, 'harvestui.disp.err.locked'));
    }
    const kind: HarvestDispositionKind = fields.kind ?? existing.kind;
    const recipient =
      fields.recipient !== undefined
        ? fields.recipient?.trim() || null
        : kind === 'sold' || kind === 'donated'
          ? existing.recipient
          : null;
    let soldAsOrganic =
      fields.soldAsOrganic !== undefined
        ? fields.soldAsOrganic
        : kind === 'sold'
          ? existing.soldAsOrganic
          : null;
    const merged = { kind, recipient, soldAsOrganic };
    const bad = dispositionProblem(merged);
    if (bad)
      return problem(
        400,
        'INVALID_BODY',
        dispositionIssueText([{ message: bad }], event.locals.locale)
      );
    if (!farmHasOrganicStatus()) soldAsOrganic = null;

    if (fields.occurredAt !== undefined) {
      const now = Date.now();
      const dated = dispositionDateProblem(
        fields.occurredAt,
        harvest.occurredAt,
        farmTimeZone(),
        now,
        event.locals.locale
      );
      if (dated) return problem(400, dated.error, dated.message);
    }
    for (const at of new Set([existing.occurredAt, fields.occurredAt ?? existing.occurredAt])) {
      const closed = checkSeasonClosed(at, event.locals?.locale);
      if (closed) {
        return json(
          { error: closed.code, message: closed.message, year: closed.year },
          { status: 422 }
        );
      }
    }
    Object.assign(changes, {
      kind: fields.kind,
      quantity: fields.quantity,
      unit: fields.unit,
      occurredAt: fields.occurredAt,
      recipient,
      soldAsOrganic
    });
  }

  const saved = db.transaction(() => {
    let out = existing;
    if (changing) out = updateHarvestDisposition(existing.id, changes) ?? out;
    if (linking) out = setDispositionLedgerEntry(existing.id, ledgerEntryId ?? null) ?? out;
    return out;
  });
  const notices = changing
    ? dispositionNotices(harvest, saved, { ...prefsFor(user.id), locale: event.locals.locale })
    : { organicNotice: null, quantityNotice: null };
  return json({ disposition: presentDisposition(saved, user.role), ...notices });
};

export const DELETE: RequestHandler = async (event) => {
  const user = currentUser(event);
  if (!user) return problem(401, 'UNAUTHENTICATED', 'Sign in to change this record.');
  if (!canMutate(user.role)) {
    return problem(403, 'READ_ONLY', t(event.locals.locale, 'harvestui.disp.err.readOnlyChange'));
  }
  const existing = getHarvestDisposition(event.params.id ?? '');
  if (!existing)
    return problem(404, 'NOT_FOUND', t(event.locals.locale, 'harvestui.disp.err.noRecord'));
  const force = event.url.searchParams.get('force') === 'true';
  const locked = evaluateDispositionLock(existing) !== undefined;
  if (locked && !force)
    return problem(409, 'RECORD_LOCKED', t(event.locals.locale, 'harvestui.disp.err.locked'));
  let reason: string | undefined;
  if (locked) {
    if (user.role !== 'owner') {
      return problem(
        403,
        'OWNER_ONLY',
        t(event.locals.locale, 'harvestui.disp.err.ownerDeleteLocked')
      );
    }
    reason = event.url.searchParams.get('reason')?.trim() ?? '';
    if (
      reason.length < DISPOSITION_FORCE_REASON_MIN ||
      reason.length > DISPOSITION_FORCE_REASON_MAX
    ) {
      return problem(
        400,
        'REASON_REQUIRED',
        t(event.locals.locale, 'harvestui.disp.err.reasonNeeded')
      );
    }
  }
  const summary = db.transaction(() =>
    deleteHarvestDisposition(existing.id, { force: locked, deletedBy: user.id, reason })
  );
  return json({ ...summary, tombstone: locked });
};

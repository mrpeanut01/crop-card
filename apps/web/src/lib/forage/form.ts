/** The forage test form's draft and its request body (Phase 33C, M-58).
 *  Pure and client-safe. */

import { t } from '$lib/i18n';
import type { ForageTestCreate } from './apiSchemas';
import type { NitrateUnits, RatingBasis } from './model';

export type ForageTestTarget =
  { blockId: string } | { hayCuttingId: string } | { stockLotId: string };

export interface ForageTestDraft {
  sampledOn: string;
  lab: string;
  nitrateValue: number | null;
  nitrateUnits: NitrateUnits | '';
  hcnPpm: number | null;
  ratingNitrate: string;
  ratingHcn: string;
  basis: RatingBasis | '';
  documentId: string | null;
}

export function emptyForageDraft(today: string): ForageTestDraft {
  return {
    sampledOn: today,
    lab: '',
    nitrateValue: null,
    nitrateUnits: '',
    hcnPpm: null,
    ratingNitrate: '',
    ratingHcn: '',
    basis: '',
    documentId: null
  };
}

const num = (v: number | null | undefined): number | undefined =>
  v === null || v === undefined || !Number.isFinite(v) ? undefined : v;

/** The body to POST, or the plain-English reason it cannot be sent. */
export function buildForageTestBody(
  target: ForageTestTarget,
  d: ForageTestDraft,
  locale?: string | null
): { ok: true; body: ForageTestCreate } | { ok: false; error: string } {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d.sampledOn)) {
    return { ok: false, error: t(locale, 'forage.form.err.day') };
  }
  const nitrateValue = num(d.nitrateValue);
  if (nitrateValue !== undefined && !d.nitrateUnits) {
    return { ok: false, error: t(locale, 'forage.form.err.units') };
  }
  const hcnPpm = num(d.hcnPpm);
  const ratingNitrate = d.ratingNitrate.trim();
  const ratingHcn = d.ratingHcn.trim();
  if (nitrateValue === undefined && hcnPpm === undefined && !ratingNitrate && !ratingHcn) {
    return { ok: false, error: t(locale, 'forage.form.err.atLeastOne') };
  }
  const labRating =
    ratingNitrate || ratingHcn || d.basis
      ? {
          ...(ratingNitrate ? { nitrate: ratingNitrate } : {}),
          ...(ratingHcn ? { hcn: ratingHcn } : {}),
          ...(d.basis ? { basis: d.basis } : {})
        }
      : undefined;
  return {
    ok: true,
    body: {
      ...target,
      sampledOn: d.sampledOn,
      ...(d.lab.trim() ? { lab: d.lab.trim() } : {}),
      ...(nitrateValue !== undefined && d.nitrateUnits
        ? { nitrateValue, nitrateUnits: d.nitrateUnits }
        : {}),
      ...(hcnPpm !== undefined ? { hcnPpm } : {}),
      ...(labRating ? { labRating } : {}),
      ...(d.documentId ? { documentId: d.documentId } : {})
    }
  };
}

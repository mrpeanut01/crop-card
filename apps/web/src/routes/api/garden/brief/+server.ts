import { json, type RequestHandler } from '@sveltejs/kit';
import { t } from '$lib/i18n';
import { filterSprayAdvice } from '$lib/journal/photoHelp';
import { requireOwner, requireUser } from '$lib/server/auth';
import { getRegistry } from '$lib/server/registry';
import { sprayTermsFor } from '$lib/server/sprayTerms';
import {
  emptyBrief,
  gardenBriefPutSchema,
  type GardenBrief,
  type ShortlistRow
} from '$lib/garden/brief/schema';
import { deterministicReason, deterministicShortlist } from '$lib/garden/brief/shortlist';
import {
  briefHerbCheck,
  deleteGardenBrief,
  loadGardenBrief,
  saveGardenBrief,
  unknownBriefIds
} from '$lib/server/garden/briefStore';

export const _requestSchema = gardenBriefPutSchema;

/** GET /api/garden/brief (Phase 37A, R-26). Every role reads the brief. */
export const GET: RequestHandler = async (event) => {
  const user = requireUser(event);
  return json({ brief: loadGardenBrief(), canEdit: user.role === 'owner' });
};

/** PUT /api/garden/brief. Owner only. Saves the answers; without a
 *  `shortlist` the deterministic one is built from them. Refuses ids that
 *  are not herbs in this farm's library. */
export const PUT: RequestHandler = async (event) => {
  requireOwner(event);
  const locale = event.locals?.locale;
  let raw: unknown;
  try {
    raw = await event.request.json();
  } catch {
    return json({ error: t(locale, 'herbsa.api.invalid') }, { status: 400 });
  }
  const parsed = gardenBriefPutSchema.safeParse(raw);
  if (!parsed.success) {
    return json(
      { error: t(locale, 'herbsa.api.invalid'), issues: parsed.error.issues },
      { status: 400 }
    );
  }
  const registry = await getRegistry();
  const known = briefHerbCheck(registry);
  const { answers } = parsed.data;
  const unknown = unknownBriefIds({ answers, shortlist: parsed.data.shortlist ?? [] }, known);
  if (unknown.length > 0) {
    return json(
      { error: t(locale, 'herbsa.api.unknownHerb'), code: 'UNKNOWN_PLUGIN', plugins: unknown },
      { status: 400 }
    );
  }
  const plain = deterministicShortlist(answers, known);
  let shortlist: ShortlistRow[] = plain.rows;
  if (parsed.data.shortlist) {
    const terms = sprayTermsFor(registry);
    const avoid = new Set(answers.avoid?.value ?? []);
    const seen = new Set<string>();
    shortlist = parsed.data.shortlist.flatMap((row) => {
      if (avoid.has(row.cropPluginId) || seen.has(row.cropPluginId)) return [];
      seen.add(row.cropPluginId);
      const filtered = filterSprayAdvice(row.because, terms);
      if (!filtered.removed && filtered.text.trim()) return [row];
      const fallback = deterministicReason(row.cropPluginId, answers);
      return [{ ...row, because: fallback.because, reasons: fallback.reasons }];
    });
  }
  const now = Date.now();
  const existing = loadGardenBrief();
  const brief: GardenBrief = {
    ...(existing ?? emptyBrief(now)),
    answers,
    shortlist,
    updatedAt: now
  };
  return json({ brief: saveGardenBrief(brief), sunWarning: plain.sunWarning });
};

/** DELETE /api/garden/brief. Owner only: start the brief over. */
export const DELETE: RequestHandler = async (event) => {
  requireOwner(event);
  deleteGardenBrief();
  return json({ ok: true });
};

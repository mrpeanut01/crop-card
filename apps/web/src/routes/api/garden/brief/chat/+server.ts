import { json, type RequestHandler } from '@sveltejs/kit';
import { t } from '$lib/i18n';
import { requireOwner } from '$lib/server/auth';
import { getRegistry } from '$lib/server/registry';
import { sprayTermsFor } from '$lib/server/sprayTerms';
import { emptyBrief, gardenBriefChatSchema } from '$lib/garden/brief/schema';
import {
  briefHerbCheck,
  loadGardenBrief,
  saveGardenBrief,
  unknownBriefIds
} from '$lib/server/garden/briefStore';
import { herbFacts, runBriefChat } from '$lib/server/garden/briefChat';
import { loadBriefFarmFacts } from '$lib/server/garden/briefContext';

export const _requestSchema = gardenBriefChatSchema;

/** POST /api/garden/brief/chat (Phase 37A, R-2). Owner only. One turn of
 *  the conversation through aiTry + aiGuard on `garden-brief`; any answer
 *  Claude cannot give comes back as the deterministic shortlist tagged
 *  `fallback`. Saves the answers and the shortlist with the turn. */
export const POST: RequestHandler = async (event) => {
  const user = requireOwner(event);
  const locale = event.locals?.locale;
  let raw: unknown;
  try {
    raw = await event.request.json();
  } catch {
    return json({ error: t(locale, 'herbsa.api.invalid') }, { status: 400 });
  }
  const parsed = gardenBriefChatSchema.safeParse(raw);
  if (!parsed.success) {
    return json(
      { error: t(locale, 'herbsa.api.invalid'), issues: parsed.error.issues },
      { status: 400 }
    );
  }
  const registry = await getRegistry();
  const known = briefHerbCheck(registry);
  const now = Date.now();
  const stored = loadGardenBrief() ?? emptyBrief(now);
  const brief = parsed.data.answers ? { ...stored, answers: parsed.data.answers } : stored;
  const unknown = unknownBriefIds({ answers: brief.answers, shortlist: [] }, known);
  if (unknown.length > 0) {
    return json(
      { error: t(locale, 'herbsa.api.unknownHerb'), code: 'UNKNOWN_PLUGIN', plugins: unknown },
      { status: 400 }
    );
  }
  const { response, brief: next } = await runBriefChat({
    userId: user.id,
    brief,
    message: parsed.data.message,
    history: parsed.data.history ?? [],
    farm: await loadBriefFarmFacts(),
    herbs: herbFacts(registry.crops()),
    known,
    sprayTerms: sprayTermsFor(registry),
    now,
    locale
  });
  return json({ ...response, brief: saveGardenBrief(next) });
};

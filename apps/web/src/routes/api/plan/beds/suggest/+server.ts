import { json, type RequestHandler } from '@sveltejs/kit';
import { getStockItem } from '$lib/db/stock';
import { resolveSpacing } from '$lib/garden/plantCount';
import { bedLayoutRequestSchema } from '$lib/plan/bedLayoutApi';
import {
  checkBedProposal,
  MAX_SUGGESTED_BEDS,
  planBeds,
  type BedLayoutCrop,
  type SuggestedBed
} from '$lib/plan/bedLayout';
import { requireOwner } from '$lib/server/auth';
import { aiLimitOf, recordFallback, tryAiWithGuard } from '$lib/server/aiDegrade';
import { recordCall } from '$lib/server/aiGuard';
import { aiLimitReason, type AiLimit } from '$lib/billing/aiLimit';
import { PLANS } from '$lib/billing/plans';
import { t, type MessageKey } from '$lib/i18n';
import { suggestBedLayout } from '$lib/server/aiBedLayout';
import { getRegistry } from '$lib/server/registry';

export const _requestSchema = bedLayoutRequestSchema;

const BED_LAYOUT_TIMEOUT_MS = 8000;

const WHY: Record<string, MessageKey> = {
  'no-key': 'wizard.beds.why.noKey',
  'over-cap': 'wizard.beds.why.overCap',
  quota: 'wizard.beds.why.quota',
  'rate-limit': 'wizard.beds.why.rateLimit',
  offline: 'wizard.beds.why.offline',
  timeout: 'wizard.beds.why.timeout',
  invalid: 'wizard.beds.why.invalid',
  'too-many-beds': 'wizard.beds.why.tooMany'
};

function limitReason(limit: AiLimit, locale: string | null | undefined): string {
  if (!locale || locale === 'en') return aiLimitReason(limit);
  if (limit.detail === 'plan-excluded') {
    return limit.plan
      ? t(locale, 'wizard.beds.limit.planExcludedNamed', { plan: PLANS[limit.plan].name })
      : t(locale, 'wizard.beds.limit.planExcluded');
  }
  const keys: Record<Exclude<AiLimit['detail'], 'plan-excluded'>, MessageKey> = {
    'monthly-budget': 'wizard.beds.why.overCap',
    'owner-disabled': 'wizard.beds.limit.ownerDisabled',
    'free-pool': 'wizard.beds.limit.freePool',
    global: 'wizard.beds.limit.global',
    'daily-quota': 'wizard.beds.why.quota',
    'token-quota': 'wizard.beds.why.quota'
  };
  return t(locale, keys[limit.detail]);
}

/** POST /api/plan/beds/suggest (#475). Beds sized for the seed being
 *  planted: Claude's grouping when it is available and checks out, else a
 *  plain plan from plugin spacing. Never saves anything; the wizard adds
 *  the beds the owner keeps through POST /api/blocks. Counts against the
 *  Fill this bed allowance. */
export const POST: RequestHandler = async (event) => {
  const user = requireOwner(event);
  const locale = event.locals?.locale;
  let raw: unknown;
  try {
    raw = await event.request.json();
  } catch {
    return json({ error: 'invalid JSON body' }, { status: 400 });
  }
  const parsed = bedLayoutRequestSchema.safeParse(raw);
  if (!parsed.success) {
    return json({ error: 'invalid request', issues: parsed.error.issues }, { status: 400 });
  }
  const registry = await getRegistry();
  const crops: BedLayoutCrop[] = [];
  const seen = new Set<string>();
  for (const s of parsed.data.seeds) {
    if (seen.has(s.stockItemId)) continue;
    seen.add(s.stockItemId);
    const item = getStockItem(s.stockItemId);
    if (!item || item.category !== 'seed') {
      return json({ error: 'unknown seed', stockItemId: s.stockItemId }, { status: 404 });
    }
    const plugin = item.pluginId ? registry.get(item.pluginId)?.plugin : undefined;
    const crop = plugin && plugin.type === 'crop' ? plugin : undefined;
    const spacing = resolveSpacing(crop as never, 'square');
    crops.push({
      key: item.id,
      name: item.shortName ?? item.displayName,
      family: crop?.cropFamily ?? null,
      plants: s.plants,
      inRowIn: spacing.inRowIn,
      rowIn: spacing.rowIn
    });
  }
  const opts = { bedWidthFt: parsed.data.bedWidthFt, maxBedLengthFt: parsed.data.maxBedLengthFt };
  const { beds: plain, unplaced } = planBeds(crops, opts);
  const leftover = unplaced.length
    ? ` ${t(locale, 'wizard.beds.leftover', {
        max: MAX_SUGGESTED_BEDS,
        list: unplaced
          .map((u) => t(locale, 'wizard.beds.leftoverItem', { count: u.plants, name: u.name }))
          .join(', ')
      })}`
    : '';

  const fallback = (why: string, limit: ReturnType<typeof aiLimitOf> = null) => ({
    beds: plain,
    provenance: 'fallback' as const,
    note: null,
    message: `${t(locale, 'wizard.beds.fallbackMsg', {
      why: limit ? limitReason(limit, locale) : t(locale, WHY[why], { max: MAX_SUGGESTED_BEDS })
    })}${leftover}`,
    unplaced,
    aiLimit: limit
  });

  if (unplaced.length > 0) return json(fallback('too-many-beds'));

  const tried = await tryAiWithGuard({
    endpoint: 'garden-fill',
    userId: user.id,
    timeoutMs: BED_LAYOUT_TIMEOUT_MS,
    prompt: (signal) => suggestBedLayout(crops, opts, signal)
  });

  if (tried.provenance === 'fallback') {
    recordFallback(user.id, 'garden-fill', tried.fallbackReason, 'bed-layout');
    const why =
      !tried.guard.ok && tried.guard.reason === 'quota-exceeded' ? 'quota' : tried.fallbackReason;
    return json(fallback(why, aiLimitOf(tried.guard)));
  }

  const { beds: proposal, note, meta } = tried.value;
  const checked = proposal ? checkBedProposal(proposal, crops, opts) : null;
  const ok = checked?.ok === true;
  try {
    recordCall({
      userId: user.id,
      endpoint: 'garden-fill',
      model: meta.model,
      inputTokens: meta.inputTokens,
      cachedInputTokens: meta.cachedInputTokens,
      outputTokens: meta.outputTokens,
      usdEstimate: meta.usdEstimate,
      success: ok,
      errorClass: ok ? undefined : proposal ? 'bed-layout-invalid' : 'invalid-json',
      provenance: ok ? 'ai' : 'fallback'
    });
  } catch (err) {
    console.error('[ai] bed-layout recordCall failed', err);
  }
  if (!checked || !checked.ok) return json(fallback('invalid'));
  const beds: SuggestedBed[] = checked.beds;
  return json({ beds, provenance: 'ai', note, message: null, unplaced: [], aiLimit: null });
};

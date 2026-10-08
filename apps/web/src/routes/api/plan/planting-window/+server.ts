import { json, type RequestHandler } from '@sveltejs/kit';
import { z } from 'zod';
import { requireOwner } from '$lib/server/auth';
import { getRegistry } from '$lib/server/registry';
import { recordCall } from '$lib/server/aiGuard';
import { recordFallback, tryAiWithGuard } from '$lib/server/aiDegrade';
import {
  getCachedWindow,
  plantingWindowCacheKey,
  setCachedWindow,
  suggestPlantingWindow,
  type PlantingWindowPromptInput
} from '$lib/server/aiPlantingWindow';
import { currentOwnerId } from '$lib/db/tenant';
import { frostDatesIsoForYear, getFarmLatLon, hasFarmLatLon } from '$lib/schedule/settings';
import {
  deterministicPlantingWindow,
  plantingWindowCropOf,
  type FrostDatesIso
} from '$lib/plan/plantingWindow';
import { getBlock } from '$lib/db/blocks';
import { loadEffectiveFrostByBlock, localDay } from '$lib/server/blockFrost.server';
import { effectiveFrostSummary, type EffectiveFrost } from '$lib/climate/effectiveFrost';
import type { CropPlugin } from '$lib/plugins/schemas';
import { t } from '$lib/i18n';

const bodySchema = z.object({
  cropPluginId: z.string().min(1),
  year: z.number().int().min(2000).max(2100),
  /** Phase 32E: the bed, so its covers shift the window. */
  blockId: z.string().min(1).optional()
});

export const POST: RequestHandler = async (event) => {
  const user = requireOwner(event);
  let raw: unknown;
  try {
    raw = await event.request.json();
  } catch {
    return json({ error: t(event.locals?.locale, 'stockui.api.invalidJson') }, { status: 400 });
  }
  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) {
    return json(
      { error: t(event.locals?.locale, 'stockui.api.invalidRequest'), issues: parsed.error.issues },
      { status: 400 }
    );
  }
  const { cropPluginId, year, blockId } = parsed.data;
  if (blockId && !getBlock(blockId)) {
    return json({ error: t(event.locals?.locale, 'api.errB.unknownBlockId') }, { status: 400 });
  }

  const registry = await getRegistry();
  const entry = registry.get(cropPluginId);
  if (!entry || entry.plugin.type !== 'crop') {
    return json({ error: t(event.locals?.locale, 'api.errB.unknownCropPlugin') }, { status: 404 });
  }
  const crop = entry.plugin as CropPlugin;

  const farmFrost = frostDatesIsoForYear(year);
  const bed = blockId ? loadEffectiveFrostByBlock([blockId], year)[blockId] : null;
  const frost: FrostDatesIso & { frostFree?: boolean } = bed
    ? bed.frostFree
      ? { lastSpring: `${year}-01-01`, firstFall: `${year}-12-31`, frostFree: true }
      : { lastSpring: localDay(bed.lastSpringFrostMs), firstFall: localDay(bed.firstFallFrostMs) }
    : farmFrost;
  const cropFacts = plantingWindowCropOf(crop);
  const baseline = deterministicPlantingWindow(cropFacts, frost);
  const input: PlantingWindowPromptInput = {
    cropPluginId,
    cropName: crop.displayName,
    ...cropFacts,
    year,
    frost,
    coverNote: bed ? effectiveFrostSummary(bed) : null,
    latLon: hasFarmLatLon() ? getFarmLatLon() : null,
    baseline
  };

  const cacheKey = plantingWindowCacheKey(currentOwnerId() ?? user.id, input);
  const cached = getCachedWindow(cacheKey);
  const frostView = {
    ...frost,
    farm: farmFrost,
    cover: bed ? bedCover(bed, event.locals?.locale) : null
  };
  if (cached) return json({ window: cached, frost: frostView, provenance: 'ai', cached: true });

  const tried = await tryAiWithGuard({
    endpoint: 'planting-window',
    locale: event.locals?.locale,
    userId: user.id,
    timeoutMs: 15_000,
    prompt: (signal) => suggestPlantingWindow(input, signal)
  });

  if (tried.provenance === 'fallback') {
    recordFallback(user.id, 'planting-window', tried.fallbackReason);
    return json({
      window: deterministicPlantingWindow(cropFacts, frost, event.locals.locale),
      frost: frostView,
      provenance: 'fallback',
      fallbackReason: tried.fallbackReason,
      message: tried.fallbackMessage
    });
  }

  const { window, meta } = tried.value;
  recordCall({
    userId: user.id,
    endpoint: 'planting-window',
    model: meta.model,
    inputTokens: meta.inputTokens,
    cachedInputTokens: meta.cachedInputTokens,
    outputTokens: meta.outputTokens,
    usdEstimate: meta.usdEstimate,
    success: true,
    provenance: 'ai'
  });
  setCachedWindow(cacheKey, window);
  return json({ window, frost: frostView, provenance: 'ai' });
};

function bedCover(e: EffectiveFrost, locale?: string | null) {
  return {
    summary: effectiveFrostSummary(e, locale),
    springShiftDays: e.springShiftDays,
    fallShiftDays: e.fallShiftDays,
    springBy: e.springBy,
    fallBy: e.fallBy,
    provenance: e.provenance,
    unknownShift: e.unknownShift,
    frostFree: e.frostFree
  };
}

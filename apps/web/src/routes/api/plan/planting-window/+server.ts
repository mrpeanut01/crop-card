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
import { deterministicPlantingWindow } from '$lib/plan/plantingWindow';
import type { CropPlugin } from '$lib/plugins/schemas';

const bodySchema = z.object({
  cropPluginId: z.string().min(1),
  year: z.number().int().min(2000).max(2100)
});

export const POST: RequestHandler = async (event) => {
  const user = requireOwner(event);
  let raw: unknown;
  try {
    raw = await event.request.json();
  } catch {
    return json({ error: 'invalid JSON body' }, { status: 400 });
  }
  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) {
    return json({ error: 'invalid request', issues: parsed.error.issues }, { status: 400 });
  }
  const { cropPluginId, year } = parsed.data;

  const registry = await getRegistry();
  const entry = registry.get(cropPluginId);
  if (!entry || entry.plugin.type !== 'crop') {
    return json({ error: 'unknown crop plugin' }, { status: 404 });
  }
  const crop = entry.plugin as CropPlugin;

  const frost = frostDatesIsoForYear(year);
  const cropFacts = {
    cropFamily: crop.cropFamily ?? null,
    soilTempMinF: crop.plantingGuide?.soilTempMinF ?? null,
    dtmMaxDays: crop.daysToMaturity?.max ?? null
  };
  const baseline = deterministicPlantingWindow(cropFacts, frost);
  const input: PlantingWindowPromptInput = {
    cropPluginId,
    cropName: crop.displayName,
    ...cropFacts,
    year,
    frost,
    latLon: hasFarmLatLon() ? getFarmLatLon() : null,
    baseline
  };

  const cacheKey = plantingWindowCacheKey(currentOwnerId() ?? user.id, input);
  const cached = getCachedWindow(cacheKey);
  if (cached) return json({ window: cached, provenance: 'ai', cached: true });

  const tried = await tryAiWithGuard({
    endpoint: 'planting-window',
    userId: user.id,
    timeoutMs: 15_000,
    prompt: (signal) => suggestPlantingWindow(input, signal)
  });

  if (tried.provenance === 'fallback') {
    recordFallback(user.id, 'planting-window', tried.fallbackReason);
    return json({
      window: baseline,
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
  return json({ window, provenance: 'ai' });
};

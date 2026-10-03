import { json, type RequestHandler } from '@sveltejs/kit';
import { z } from 'zod';
import { requireOwner } from '$lib/server/auth';
import { getRegistry } from '$lib/server/registry';
import { buildAllocationInput } from '$lib/server/allocationInput';
import { seedSelectionSchema } from '$lib/plan/allocationApi';
import { buildFarmContextWithCache } from '$lib/server/aiContext';
import { allocate, allocateDeterministic, type AllocationResult } from '$lib/server/aiAllocation';
import { recordCall } from '$lib/server/aiGuard';
import { degradeTag, recordFallback, tryAiWithGuard } from '$lib/server/aiDegrade';
import { getActivePlanningYear } from '$lib/season/planningYear.server';

const bodySchema = z.object({
  seedSelections: z.array(seedSelectionSchema).min(1).max(50),
  blockIds: z.array(z.string().min(1)).min(1).max(50),
  year: z.number().int().min(2000).max(2100).optional(),
  /** Phase 17 (Track 3.4) — when supplied, the AI conversation threads with
   *  prior turns from the same session (suggest/groups). */
  planningSessionId: z.string().min(1).optional()
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

  const registry = await getRegistry();
  const assembled = buildAllocationInput(
    registry,
    parsed.data.seedSelections,
    parsed.data.blockIds
  );
  if (!assembled.ok) return json(assembled.body, { status: assembled.status });
  const { planInput, companionSystems } = assembled;

  const year = parsed.data.year ?? getActivePlanningYear();

  // Invariant 7 — every degradation (no key, cap, quota, timeout, upstream
  // error) goes through aiTry() via tryAiWithGuard and ends in the
  // deterministic engine plan tagged `meta.fallback`, never a 4xx/5xx.
  const tried = await tryAiWithGuard({
    endpoint: 'allocate',
    userId: user.id,
    prompt: async () => {
      const built = await buildFarmContextWithCache(year);
      return allocate(planInput, built.context, {
        planningSessionId: parsed.data.planningSessionId,
        contextCacheHit: built.cacheHit,
        contextVersion: built.contextVersion,
        companionSystems
      });
    }
  });

  let result: AllocationResult;
  let fallbackMessage: string | null = null;
  if (tried.provenance === 'fallback') {
    fallbackMessage = tried.fallbackMessage;
    const tag = degradeTag(tried.fallbackReason, tried.guard);
    result = allocateDeterministic(
      planInput,
      tag === 'quota-exceeded' && !tried.guard.ok && tried.guard.reason === 'cap-exceeded'
        ? 'over-cap'
        : tag,
      tag === 'ai-unavailable' ? fallbackMessage : undefined
    );
    recordFallback(user.id, 'allocate', tried.fallbackReason);
  } else {
    result = tried.value;
    recordCall({
      userId: user.id,
      endpoint: 'allocate',
      model: result.meta.model,
      inputTokens: result.meta.inputTokens,
      cachedInputTokens: result.meta.cachedInputTokens,
      outputTokens: result.meta.outputTokens,
      usdEstimate: result.meta.usdEstimate,
      success: result.assignments.length > 0,
      errorClass: result.meta.fallback,
      provenance: result.meta.fallback ? 'fallback' : 'ai'
    });
  }

  return json({
    assignments: result.assignments,
    unplaced: result.unplaced,
    leftover: result.leftover,
    sharedBedBlockIds: [...(planInput.bedBlockIds ?? [])],
    sufficiency: result.sufficiency,
    rationale: result.rationale,
    perRowRationale: result.perRowRationale,
    advisories: result.advisories,
    pollinationConstraints: result.pollinationConstraints,
    geometryMissingBlockIds: result.geometryMissingBlockIds,
    companionGroups: result.companionGroups,
    meta: {
      model: result.meta.model,
      usdEstimate: result.meta.usdEstimate,
      fallback: result.meta.fallback,
      violationsOnFirstAttempt: result.meta.violationsOnFirstAttempt
    },
    spend: tried.guard.ok ? tried.guard.spend : null,
    guardMessage: tried.guard.ok ? null : tried.guard.message,
    fallbackMessage
  });
};

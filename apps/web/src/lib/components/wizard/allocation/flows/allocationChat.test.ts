import { describe, expect, it, vi } from 'vitest';

const pageState = vi.hoisted(() => ({ page: { data: { locale: 'en' as string | undefined } } }));
vi.mock('$app/state', () => pageState);

import { AllocationChatFlow } from './allocationChat';
import type { AllocationWizardState } from '../wizardState.svelte';
import type { AllocateFlow } from './allocateFlow';
import { t } from '$lib/i18n';

function fakeWizard() {
  const w = {
    response: {
      assignments: [
        {
          stockItemId: 's1',
          cropPluginId: 'bean',
          varietyDisplayName: 'Bean',
          blockId: 'b1',
          plants: 10
        }
      ],
      unplaced: [],
      sufficiency: {},
      rationale: 'Engine plan.',
      perRowRationale: {},
      advisories: [],
      meta: {
        model: 'claude',
        usdEstimate: 0.01,
        fallback: 'engine-only' as const,
        violationsOnFirstAttempt: ['assignment[0] plants=30 exceeds plantsFit=20 for (s1, b1)']
      }
    },
    lastRejectedAssignments: [
      {
        stockItemId: 's1',
        cropPluginId: 'bean',
        varietyDisplayName: 'Bean',
        blockId: 'b1',
        plants: 30
      }
    ],
    lastRejectedRationale: 'Packed.',
    lastRejectedViolations: ['too many'],
    allocationChatMessages: [] as Array<{ role: string; content: string }>
  };
  return w;
}

describe('AllocationChatFlow.applyRejectedAnyway', () => {
  it("tags the applied plan as Claude's (R-31) and notes the override in the chat", () => {
    pageState.page.data.locale = 'en';
    const w = fakeWizard();
    const flow = new AllocationChatFlow(
      w as unknown as AllocationWizardState,
      {} as unknown as AllocateFlow
    );
    flow.applyRejectedAnyway();
    expect(w.response.assignments[0].plants).toBe(30);
    expect(w.response.meta.fallback).toBeUndefined();
    expect(w.response.meta.violationsOnFirstAttempt).toBeUndefined();
    expect(w.response.meta.model).toBe('claude');
    expect(w.allocationChatMessages.at(-1)?.content).toBe(t('en', 'wizard.override.applied'));
    expect(w.lastRejectedAssignments).toBeNull();
  });

  it('writes the override note in Spanish for a Spanish page', () => {
    pageState.page.data.locale = 'es';
    const w = fakeWizard();
    new AllocationChatFlow(
      w as unknown as AllocationWizardState,
      {} as unknown as AllocateFlow
    ).applyRejectedAnyway();
    expect(w.allocationChatMessages.at(-1)?.content).toBe(t('es', 'wizard.override.applied'));
    expect(t('es', 'wizard.override.applied')).not.toBe(t('en', 'wizard.override.applied'));
  });
});

describe('AllocationChatFlow.sendAllocationChat on a degraded refine (#709)', () => {
  it('keeps the plan provenance and companion groups when the server echoes the plan', async () => {
    pageState.page.data.locale = 'en';
    const engineMeta = { model: 'engine-fallback', usdEstimate: 0, fallback: 'over-cap' as const };
    const companionGroups = [{ id: 'g1' }];
    const w = {
      ...fakeWizard(),
      selectedBlockIds: new Set(['b1']),
      humanizeAllocationViolation: (v: string) => v,
      persistChatMessage: vi.fn(async () => {})
    };
    w.response = { ...w.response, meta: engineMeta, companionGroups } as never;
    const echo = {
      reply: 'AI help is turned off for this farm. The current plan is unchanged.',
      assignments: w.response.assignments,
      unplaced: [],
      sufficiency: {},
      rationale: 'Engine plan.',
      perRowRationale: {},
      advisories: [],
      companionGroups: [],
      meta: { model: 'echo', usdEstimate: 0, provenance: 'fallback', fallbackReason: 'over-cap' }
    };
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(echo), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    try {
      const flow = new AllocationChatFlow(
        w as unknown as AllocationWizardState,
        {
          buildSeedSelections: () => []
        } as unknown as AllocateFlow
      );
      await flow.sendAllocationChat('move the beans');
    } finally {
      vi.unstubAllGlobals();
    }
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const after = w.response as unknown as { meta: unknown; companionGroups: unknown };
    expect(after.meta).toEqual(engineMeta);
    expect(after.companionGroups).toEqual(companionGroups);
  });

  it('a real refine answer replaces the plan meta', async () => {
    pageState.page.data.locale = 'en';
    const w = {
      ...fakeWizard(),
      selectedBlockIds: new Set(['b1']),
      humanizeAllocationViolation: (v: string) => v,
      persistChatMessage: vi.fn(async () => {})
    };
    const aiMeta = { model: 'claude-x', usdEstimate: 0.02 };
    const answer = {
      reply: 'Moved.',
      assignments: w.response.assignments,
      rationale: 'AI plan.',
      perRowRationale: {},
      advisories: [],
      meta: aiMeta
    };
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify(answer), { status: 200 }))
    );
    try {
      const flow = new AllocationChatFlow(
        w as unknown as AllocationWizardState,
        {
          buildSeedSelections: () => []
        } as unknown as AllocateFlow
      );
      await flow.sendAllocationChat('move the beans');
    } finally {
      vi.unstubAllGlobals();
    }
    expect((w.response as unknown as { meta: unknown }).meta).toEqual(aiMeta);
  });
});

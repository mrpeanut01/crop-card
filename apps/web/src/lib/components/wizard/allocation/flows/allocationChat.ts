import type { AllocationWizardState } from '../wizardState.svelte';
import type { ChatMsg } from '../types';
import type { AllocateFlow } from './allocateFlow';

/** Shared chat send path (routes to the schedule chat on step 4) plus the
 *  Review-step allocation refine chat and its "Apply anyway" override. */
export class AllocationChatFlow {
  #w: AllocationWizardState;
  #allocate: AllocateFlow;

  constructor(w: AllocationWizardState, allocate: AllocateFlow) {
    this.#w = w;
    this.#allocate = allocate;
  }

  async sendChat() {
    const text = this.#w.chatDraft.trim();
    if (!text || this.#w.chatBusy || !this.#w.response) return;
    this.#w.chatError = null;
    const userTurn: ChatMsg = { role: 'user', content: text };
    // Append to the active step's transcript optimistically.
    const chatStepKey: 'allocation' | 'schedule' =
      this.#w.step === 'schedule' ? 'schedule' : 'allocation';
    if (chatStepKey === 'schedule') {
      this.#w.scheduleChatMessages = [...this.#w.scheduleChatMessages, userTurn];
    } else {
      this.#w.allocationChatMessages = [...this.#w.allocationChatMessages, userTurn];
    }
    // Phase 25d (#89) — fire-and-forget server persist; doesn't block UI.
    void this.#w.persistChatMessage(chatStepKey, 'user', text);
    this.#w.chatDraft = '';
    this.#w.chatBusy = true;
    this.#w.chatStartMs = Date.now();
    this.#w.nowMs = Date.now();
    this.#w.queueScrollChat();
    try {
      // Chat routes through schedule-refinement when in step 4, otherwise
      // allocator-refinement. Each path mutates its own transcript.
      if (this.#w.step === 'schedule' && this.#w.scheduleResponse) {
        await this.#w.sendScheduleChat(text);
      } else {
        await this.sendAllocationChat(text);
      }
      this.#w.queueScrollChat();
    } catch (err) {
      this.#w.chatError = err instanceof Error ? err.message : 'chat request failed';
      // Roll back the optimistic user message on hard error.
      if (this.#w.step === 'schedule') {
        this.#w.scheduleChatMessages = this.#w.scheduleChatMessages.slice(0, -1);
      } else {
        this.#w.allocationChatMessages = this.#w.allocationChatMessages.slice(0, -1);
      }
      this.#w.chatDraft = text;
    } finally {
      this.#w.chatBusy = false;
      this.#w.chatStartMs = null;
    }
  }

  async sendAllocationChat(text: string) {
    const response = this.#w.response;
    if (!response) return;
    const seedSelections = this.#allocate.buildSeedSelections();
    const previousPlan = {
      assignments: response.assignments.map((a) => ({
        stockItemId: a.stockItemId,
        blockId: a.blockId,
        plants: a.plants,
        rationale: response.perRowRationale[`${a.stockItemId}:${a.blockId}`] ?? ''
      })),
      rationale: response.rationale,
      advisories: response.advisories
    };
    const sendable = this.#w.allocationChatMessages
      .filter((m) => m.kind !== 'seed')
      .map((m) => ({ role: m.role, content: m.content }));
    const res = await fetch('/api/plan/allocate/refine', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        seedSelections,
        blockIds: [...this.#w.selectedBlockIds],
        previousPlan,
        transcript: sendable
      })
    });
    const body = await res.json();
    if (!res.ok) {
      this.#w.chatError = body?.error ?? `HTTP ${res.status}`;
      this.#w.allocationChatMessages = this.#w.allocationChatMessages.slice(0, -1);
      this.#w.chatDraft = text;
      return;
    }
    // When the server fell back (validation failed both passes, parse
    // failed, etc.), body.assignments is the PREVIOUS unchanged plan
    // but the AI's reply may still confidently claim it made changes.
    // Prefix a warning + humanized violations so the operator sees the
    // table didn't update, then capture the AI's rejected proposal so
    // the "Apply anyway" affordance can offer it.
    const fallback: string | undefined = body?.meta?.fallback;
    const rawViolations: string[] = Array.isArray(body?.meta?.violationsOnFirstAttempt)
      ? body.meta.violationsOnFirstAttempt
      : [];
    const violations = rawViolations.map((v) => this.#w.humanizeAllocationViolation(v));
    const aiReply: string =
      typeof body.reply === 'string' && body.reply.trim().length > 0
        ? body.reply
        : fallback
          ? 'The plan above is unchanged.'
          : 'Done — updated the plan above.';
    let reply = aiReply;
    if (fallback) {
      const header =
        fallback === 'engine-only'
          ? '⚠ Could not apply the change cleanly — the planning rules flagged it. The plan above is unchanged.'
          : `⚠ The plan above is unchanged (${fallback}).`;
      const violationLine = violations.length > 0 ? `\n\nWhy:\n• ${violations.join('\n• ')}` : '';
      const overrideHint =
        Array.isArray(body?.meta?.rejectedAssignments) && body.meta.rejectedAssignments.length > 0
          ? "\n\nIf you've reviewed and want to accept the AI's plan anyway, use “Apply anyway” below."
          : '';
      reply = `${header}${violationLine}${overrideHint}\n\n${aiReply}`;

      // Capture the rejected proposal + a sticky violation list so the
      // template can render the override button.
      if (Array.isArray(body?.meta?.rejectedAssignments)) {
        this.#w.lastRejectedAssignments = body.meta.rejectedAssignments;
        this.#w.lastRejectedRationale =
          typeof body.meta.rejectedRationale === 'string' ? body.meta.rejectedRationale : '';
        this.#w.lastRejectedViolations = violations;
      } else {
        this.#w.lastRejectedAssignments = null;
        this.#w.lastRejectedRationale = '';
        this.#w.lastRejectedViolations = [];
      }
    } else {
      // Successful refine — clear any stale rejected proposal.
      this.#w.lastRejectedAssignments = null;
      this.#w.lastRejectedRationale = '';
      this.#w.lastRejectedViolations = [];
    }
    this.#w.allocationChatMessages = [
      ...this.#w.allocationChatMessages,
      { role: 'assistant', content: reply }
    ];
    void this.#w.persistChatMessage('allocation', 'assistant', reply);
    this.#w.response = {
      assignments: body.assignments,
      unplaced: body.unplaced ?? [],
      sufficiency: body.sufficiency ?? {},
      rationale: body.rationale ?? response.rationale,
      perRowRationale: body.perRowRationale ?? {},
      advisories: Array.isArray(body.advisories) ? body.advisories : [],
      pollinationConstraints: Array.isArray(body.pollinationConstraints)
        ? body.pollinationConstraints
        : response.pollinationConstraints,
      geometryMissingBlockIds: Array.isArray(body.geometryMissingBlockIds)
        ? body.geometryMissingBlockIds
        : response.geometryMissingBlockIds,
      companionGroups: Array.isArray(body.companionGroups)
        ? body.companionGroups
        : response.companionGroups,
      meta: body.meta ?? response.meta
    };
  }

  /** Phase 21b follow-up — operator override. Swaps the response in
   *  place with the AI's last rejected proposal so the planning grid
   *  reflects the operator's accepted-anyway plan. Adds an assistant
   *  message noting the override so the audit trail lives in the chat. */
  applyRejectedAnyway() {
    if (!this.#w.response || !this.#w.lastRejectedAssignments) return;
    const overridden = [...this.#w.lastRejectedAssignments];
    this.#w.response = {
      ...this.#w.response,
      assignments: overridden,
      rationale: this.#w.lastRejectedRationale || this.#w.response.rationale,
      // Per-row rationale is cleared — the detailed per-pair text lived
      // only in the rejected proposal before validation stripped it.
      perRowRationale: {},
      // Unplaced + sufficiency are recomputed by the next refine; until
      // then, clear them so the operator doesn't read stale numbers.
      unplaced: [],
      sufficiency: {}
    };
    this.#w.allocationChatMessages = [
      ...this.#w.allocationChatMessages,
      {
        role: 'assistant',
        content:
          '✅ Applied the AI plan over the validator. The grid above shows the new layout. ' +
          'Density / capacity checks were overridden — review the plant counts before committing.'
      }
    ];
    this.#w.lastRejectedAssignments = null;
    this.#w.lastRejectedRationale = '';
    this.#w.lastRejectedViolations = [];
  }
}

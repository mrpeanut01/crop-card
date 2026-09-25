import type { InputsPlanProvisionalPlanting } from '$lib/plan/inputsPlan';
import type { AllocationWizardState } from '../wizardState.svelte';
import type { ScheduleResponse } from '../types';

/** Step 3 → 4 → 5: POST /api/plan/schedule, the schedule refine chat, and
 *  the handoff into the Inputs Plan step. */
export class ScheduleFlow {
  #w: AllocationWizardState;

  constructor(w: AllocationWizardState) {
    this.#w = w;
  }

  /** Phase B1 — "Accept all" no longer commits. It locks the spatial
   *  allocation in place and advances to the Schedule step, where the
   *  scheduler proposes planting dates (Phase B3+) before the operator
   *  commits crops to the DB. The same chat panel continues in step 4. */
  async advanceToSchedule() {
    const response = this.#w.response;
    if (!response) return;
    this.#w.step = 'schedule';
    this.#w.scheduleResponse = null;
    this.#w.scheduleError = null;
    this.#w.scheduleLoading = true;
    this.#w.scheduleStartMs = Date.now();
    this.#w.nowMs = Date.now();
    try {
      const res = await fetch('/api/plan/schedule', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          assignments: response.assignments,
          pollinationConstraints: response.pollinationConstraints ?? [],
          companionGroups: response.companionGroups ?? []
        })
      });
      const body = (await res.json()) as ScheduleResponse | { error: string };
      if (!res.ok) {
        this.#w.scheduleError = 'error' in body ? body.error : `HTTP ${res.status}`;
        return;
      }
      const scheduleResponse = body as ScheduleResponse;
      this.#w.scheduleResponse = scheduleResponse;
      const lines: string[] = [];
      const fb = scheduleResponse.meta.fallback;
      if (fb === 'no-api-key' || fb === 'ai-unavailable') {
        lines.push(
          fb === 'no-api-key'
            ? '🛟 I picked dates with the deterministic scheduler (no Anthropic API key configured). Staggers and companion offsets are honored.'
            : '🛟 I picked dates with the deterministic scheduler (Claude is unavailable right now). Staggers and companion offsets are honored.'
        );
        if (scheduleResponse.rationale) lines.push(scheduleResponse.rationale);
        lines.push('');
        lines.push(
          'Tell me anything to change — e.g., "plant the corn the first week of May" or "push the brassicas two weeks later."'
        );
      } else if (fb === 'deterministic') {
        // Help-seeking chat dialogue: the server's diagnosis names specific
        // varieties + actionable suggestions in plain English. We don't show
        // raw validator strings.
        const dx = scheduleResponse.meta.diagnosis;
        if (dx && (dx.summary || dx.suggestions.length > 0)) {
          if (dx.summary) {
            lines.push(`🛟 ${dx.summary}`);
            lines.push('');
            lines.push(
              "I went with a safe-default plan above so you're not stuck — but you can probably do better. Here's what might help:"
            );
          } else {
            lines.push(
              "🛟 I couldn't fit your schedule cleanly. The deterministic plan above is a safe default, but here's what might help:"
            );
          }
          if (dx.suggestions.length > 0) {
            lines.push('');
            for (const s of dx.suggestions) lines.push(`  • ${s}`);
          }
          lines.push('');
          lines.push('What would you like me to try?');
        } else {
          // Diagnosis missing (older server, edge case) — keep a clean
          // fallback message without the technical violation list.
          lines.push(
            "🛟 I couldn't fit your schedule cleanly, even after a retry. The deterministic plan above honors every hard constraint but isn't necessarily the most elegant arrangement."
          );
          lines.push('');
          lines.push(
            'Tell me what to adjust — for example: "drop one corn variety", "skip successions for sweet corn", or "just keep these dates and commit".'
          );
        }
      } else {
        lines.push('📅 Planting dates proposed above.');
        if (scheduleResponse.rationale) lines.push(scheduleResponse.rationale);
        if (scheduleResponse.advisories.length > 0) {
          lines.push('');
          for (const a of scheduleResponse.advisories) lines.push(`• ${a}`);
        }
        lines.push('');
        lines.push(
          'Tell me anything to change — e.g., "plant the corn the first week of May" or "push the brassicas two weeks later."'
        );
      }
      // Start the schedule chat clean — don't carry allocation-step
      // pollination notes or rationale into this conversation. Anything the
      // user wants to revisit about the layout is on the Review step.
      // Phase 25d (#89) — preserve resumed turns; only insert the seed
      // when starting fresh.
      if (this.#w.scheduleChatMessages.length === 0) {
        this.#w.scheduleChatMessages = [
          { role: 'assistant', content: lines.join('\n'), kind: 'seed' }
        ];
      }
      this.#w.queueScrollChat();
    } catch (e) {
      this.#w.scheduleError = e instanceof Error ? e.message : 'schedule request failed';
    } finally {
      this.#w.scheduleLoading = false;
      this.#w.scheduleStartMs = null;
    }
  }

  async sendScheduleChat(text: string) {
    const response = this.#w.response;
    const scheduleResponse = this.#w.scheduleResponse;
    if (!response || !scheduleResponse) return;
    const sendable = this.#w.scheduleChatMessages
      .filter((m) => m.kind !== 'seed')
      .map((m) => ({ role: m.role, content: m.content }));
    const res = await fetch('/api/plan/schedule/refine', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        assignments: response.assignments.map((a) => ({
          stockItemId: a.stockItemId,
          blockId: a.blockId,
          cropPluginId: a.cropPluginId,
          varietyDisplayName: a.varietyDisplayName,
          plants: a.plants
        })),
        pollinationConstraints: response.pollinationConstraints ?? [],
        companionGroups: response.companionGroups ?? [],
        previousScheduled: scheduleResponse.scheduled,
        previousRationale: scheduleResponse.rationale,
        previousAdvisories: scheduleResponse.advisories,
        transcript: sendable
      })
    });
    const body = await res.json();
    if (!res.ok) {
      this.#w.chatError = body?.error ?? `HTTP ${res.status}`;
      this.#w.scheduleChatMessages = this.#w.scheduleChatMessages.slice(0, -1);
      this.#w.chatDraft = text;
      return;
    }
    // When the server fell back (validation failed, parse failed, no API
    // key), the `scheduled` array is the PREVIOUS unchanged plan — the
    // AI's reply may still confidently claim "I moved planting X to date
    // Y", which is misleading. Prefix the chat message with a warning
    // banner so the operator knows the table above did NOT update, and
    // surface the violation list when available.
    const fallback: string | undefined = body?.meta?.fallback;
    const violations: string[] = Array.isArray(body?.meta?.violations) ? body.meta.violations : [];
    const aiReply: string =
      typeof body.reply === 'string' && body.reply.trim().length > 0
        ? body.reply
        : fallback
          ? 'The schedule above is unchanged.'
          : 'Done — updated the dates above.';
    let reply = aiReply;
    if (fallback) {
      const header =
        fallback === 'no-api-key'
          ? '⚠ No Anthropic API key configured — the schedule above is unchanged.'
          : fallback === 'ai-unavailable'
            ? '⚠ Claude is unavailable — the schedule above is unchanged.'
            : '⚠ Could not apply the change — it would break a planting window, stagger, or companion offset. The schedule above is unchanged.';
      const violationLine =
        violations.length > 0 ? `\n\nValidator violations:\n• ${violations.join('\n• ')}` : '';
      reply = `${header}${violationLine}\n\n${aiReply}`;
    }
    this.#w.scheduleChatMessages = [
      ...this.#w.scheduleChatMessages,
      { role: 'assistant', content: reply }
    ];
    void this.#w.persistChatMessage('schedule', 'assistant', reply);
    this.#w.scheduleResponse = {
      scheduled: Array.isArray(body.scheduled) ? body.scheduled : scheduleResponse.scheduled,
      rationale: typeof body.rationale === 'string' ? body.rationale : scheduleResponse.rationale,
      advisories: Array.isArray(body.advisories) ? body.advisories : scheduleResponse.advisories,
      meta: body.meta ?? scheduleResponse.meta
    };
  }

  /** Phase 21b / B-28 — between Schedule and Commit. Advances to the
   *  Inputs Plan step where the deterministic planner proposes per-
   *  planting product applications + IPM scout cadences against the
   *  current season setup. The accept handler stashes the operator's
   *  chosen subset and then calls `commit()` so plantings + tasks
   *  persist as one action. */
  advanceToInputs() {
    if (!this.#w.response || !this.#w.scheduleResponse) return;
    this.#w.step = 'inputs';
    this.#w.acceptedInputs = null;
    this.#w.inputsCommitError = null;
  }

  /** Provisional plantings (in-memory shape) handed to the Inputs Plan
   *  step. The planner uses these as the basis for per-block work; the
   *  underlying `crops` rows don't exist yet — they get persisted when
   *  the operator clicks "Accept and commit" inside the step. */
  provisionalPlantings(): InputsPlanProvisionalPlanting[] {
    if (!this.#w.scheduleResponse) return [];
    return this.#w.scheduleResponse.scheduled.map((s, i) => ({
      id: `${s.stockItemId}:${s.blockId}:${i}`,
      blockId: s.blockId,
      cropPluginId: s.cropPluginId,
      varietyDisplayName: s.varietyDisplayName,
      plantingDate: s.plantingDateMs
    }));
  }
}

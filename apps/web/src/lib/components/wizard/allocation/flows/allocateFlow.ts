import type { AllocationWizardState } from '../wizardState.svelte';
import type { AllocationResponse } from '../types';
import { pollinationNote } from '$lib/plan/pollinationNote';
import { wt } from '../wt';

/** Step 2 → 3: POST /api/plan/allocate and seed the allocation chat with
 *  the response's pollination notes + advisories. */
export class AllocateFlow {
  #w: AllocationWizardState;

  constructor(w: AllocationWizardState) {
    this.#w = w;
  }

  buildSeedSelections() {
    return [...this.#w.selectedSeeds.entries()]
      .filter(([id, qty]) => qty > 0 || this.#w.isFillToBed(id))
      .map(([stockItemId, quantity]) => {
        const entry = this.#w.props.seedStock.find((s) => s.stockItemId === stockItemId)!;
        // Prefer the curated shortName so Claude's rationale + chips
        // surface "Bloody Butcher" instead of "Bloody Butcher
        // Ornamental Corn — Raw Untreated Non-GMO (1/2 lb)". Falls back
        // to displayName when no shortName is set.
        const varietyDisplayName = entry.shortName ?? entry.displayName;
        if (this.#w.isFillToBed(stockItemId)) {
          // #471 — no quantity anywhere: the server sizes it to the bed.
          return {
            stockItemId,
            cropPluginId: entry.cropPluginId!,
            varietyDisplayName,
            fillToBed: true as const
          };
        }
        const plants = this.#w.plantsFor(stockItemId, quantity);
        return {
          stockItemId,
          cropPluginId: entry.cropPluginId!,
          varietyDisplayName,
          quantityPlants: Math.max(1, plants ?? Math.round(quantity))
        };
      });
  }

  seedChatFromAdvisories(r: AllocationResponse) {
    const lines: string[] = [];
    const pollination = r.pollinationConstraints ?? [];
    const mustStagger = pollination.filter((p) => p.kind === 'must-stagger');
    const isolated = pollination.filter((p) => p.kind === 'isolated-spatially');
    const geomMissing = (r.geometryMissingBlockIds ?? []).length;

    if (mustStagger.length > 0 || isolated.length > 0 || geomMissing > 0) {
      lines.push(wt('wizard.seedchat.pollHeader'));
      for (const p of isolated) lines.push(`• ${pollinationNote(p, this.#w.prefs)}`);
      for (const p of mustStagger) lines.push(`• ⚠ ${pollinationNote(p, this.#w.prefs)}`);
      if (geomMissing > 0) {
        lines.push(wt('wizard.seedchat.geomMissing', { count: geomMissing }));
      }
      lines.push('');
    }

    if (r.advisories.length > 0) {
      lines.push(wt('wizard.seedchat.otherThings'));
      for (const a of r.advisories) lines.push(`• ${a}`);
      lines.push('');
    }

    if (mustStagger.length > 0) {
      lines.push(wt('wizard.seedchat.pairs'));
    } else if (lines.length === 0) {
      lines.push(wt('wizard.seedchat.clean'));
    } else {
      lines.push(wt('wizard.seedchat.change'));
    }

    // Seed message is NOT persisted — it's deterministic from the
    // current advisories. On resume from a server-hydrated transcript,
    // we skip re-seeding entirely so the prior conversation renders
    // intact. Persisting the seed would double-seed on the second
    // wizard open; replacing the transcript with the seed would erase
    // the resumed chat. Keeping in-memory only is the right balance.
    if (this.#w.allocationChatMessages.length === 0) {
      this.#w.allocationChatMessages = [
        { role: 'assistant', content: lines.join('\n'), kind: 'seed' }
      ];
    }
    this.#w.chatDraft = '';
    this.#w.chatError = null;
  }

  async generatePlan() {
    this.#w.loading = true;
    this.#w.error = null;
    this.#w.response = null;
    this.#w.allocateStartMs = Date.now();
    this.#w.nowMs = Date.now();
    // Advance to the Review step immediately so the operator sees the
    // staged AI-progress indicator (label + spinner + elapsed time) from
    // second 0, instead of staring at "Generating…" on the Blocks-step
    // button for a minute.
    this.#w.step = 'review';
    try {
      const seedSelections = this.buildSeedSelections();

      const res = await fetch('/api/plan/allocate', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          seedSelections,
          blockIds: [...this.#w.selectedBlockIds]
        })
      });
      const body = (await res.json()) as AllocationResponse | { error: string };
      if (!res.ok) {
        this.#w.error = 'error' in body ? body.error : `HTTP ${res.status}`;
        return;
      }
      this.#w.response = body as AllocationResponse;
      this.seedChatFromAdvisories(this.#w.response);
    } catch (err) {
      this.#w.error = err instanceof Error ? err.message : 'request failed';
    } finally {
      this.#w.loading = false;
      this.#w.allocateStartMs = null;
    }
  }
}

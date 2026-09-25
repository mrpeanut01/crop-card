import type { AllocationWizardState } from '../wizardState.svelte';
import type { Step } from '../types';

const VALID_STEPS: Step[] = [
  'season-setup',
  'plan-state',
  'seeds',
  'blocks',
  'review',
  'schedule',
  'inputs',
  'commit'
];

/** #173 — Save & resume later: snapshot the in-progress step + form state
 *  to /api/plan/wizard/draft, restore it on re-open, clear it on commit. */
export class DraftFlow {
  #w: AllocationWizardState;

  constructor(w: AllocationWizardState) {
    this.#w = w;
  }

  async saveAndResumeLater(): Promise<void> {
    this.#w.draftSaving = true;
    this.#w.draftSaveError = null;
    try {
      const res = await fetch('/api/plan/wizard/draft', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          step: this.#w.step,
          payload: {
            step: this.#w.step,
            selectedSeeds: [...this.#w.selectedSeeds.entries()],
            selectedBlockIds: [...this.#w.selectedBlockIds],
            chatDraft: this.#w.chatDraft
          }
        })
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
        this.#w.draftSaveError = body.error ?? `HTTP ${res.status}`;
        return;
      }
      this.#w.props.onClose();
    } catch (e) {
      this.#w.draftSaveError = e instanceof Error ? e.message : String(e);
    } finally {
      this.#w.draftSaving = false;
    }
  }

  async discardDraft(): Promise<void> {
    try {
      await fetch('/api/plan/wizard/draft', { method: 'DELETE' });
    } catch {
      // non-fatal — the row will get overwritten on the next save or
      // cleared when the wizard commits.
    }
  }

  hydrateDraft(): void {
    if (this.#w.draftHydrated) return;
    this.#w.draftHydrated = true;
    (async () => {
      try {
        const res = await fetch('/api/plan/wizard/draft');
        if (!res.ok) return;
        const body = (await res.json()) as {
          draft: {
            step: string;
            payload: {
              selectedSeeds: Array<[string, number]>;
              selectedBlockIds: string[];
              chatDraft: string;
            };
          } | null;
        };
        if (!body.draft) return;
        if (body.draft.payload.selectedSeeds.length > 0) {
          this.#w.selectedSeeds = new Map(body.draft.payload.selectedSeeds);
        }
        if (body.draft.payload.selectedBlockIds.length > 0) {
          this.#w.selectedBlockIds = new Set(body.draft.payload.selectedBlockIds);
        }
        if (body.draft.payload.chatDraft) {
          this.#w.chatDraft = body.draft.payload.chatDraft;
        }
        if ((VALID_STEPS as string[]).includes(body.draft.step)) {
          this.#w.step = body.draft.step as Step;
        }
      } catch {
        // Resume is best-effort — keep the wizard usable even if the
        // draft fetch fails.
      }
    })();
  }
}

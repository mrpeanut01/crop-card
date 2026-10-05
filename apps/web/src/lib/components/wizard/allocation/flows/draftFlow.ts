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

/** The step a saved draft re-opens on. The allocation, schedule and inputs
 *  live only in memory, so a draft saved on Review or later re-opens on
 *  Blocks with its selections, one click from generating the plan again;
 *  the Season Setup gate is never skipped. */
export function resumeStepFor(saved: string): Step | null {
  if (!(VALID_STEPS as string[]).includes(saved)) return null;
  const step = saved as Step;
  if (step === 'season-setup') return null;
  if (step === 'review' || step === 'schedule' || step === 'inputs' || step === 'commit') {
    return 'blocks';
  }
  return step;
}

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
            fillToBedSeeds: [...this.#w.fillToBedSeeds],
            inputOverrides: this.#w.inputOverrides,
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
    const stepAtStart = this.#w.step;
    (async () => {
      try {
        const res = await fetch('/api/plan/wizard/draft');
        if (!res.ok) return;
        const body = (await res.json()) as {
          draft: {
            step: string;
            payload: {
              selectedSeeds: Array<[string, number]>;
              fillToBedSeeds?: string[];
              inputOverrides?: Record<string, string>;
              selectedBlockIds: string[];
              chatDraft: string;
            };
          } | null;
        };
        if (!body.draft) return;
        if (body.draft.payload.selectedSeeds.length > 0) {
          this.#w.selectedSeeds = new Map(body.draft.payload.selectedSeeds);
        }
        if (body.draft.payload.inputOverrides) {
          this.#w.inputOverrides = body.draft.payload.inputOverrides;
        }
        if (body.draft.payload.fillToBedSeeds?.length) {
          this.#w.fillToBedSeeds = new Set(body.draft.payload.fillToBedSeeds);
        }
        if (body.draft.payload.selectedBlockIds.length > 0) {
          this.#w.selectedBlockIds = new Set(body.draft.payload.selectedBlockIds);
        }
        if (body.draft.payload.chatDraft) {
          this.#w.chatDraft = body.draft.payload.chatDraft;
        }
        const resumeStep = resumeStepFor(body.draft.step);
        if (resumeStep && this.#w.activeSetup && this.#w.step === stepAtStart) {
          this.#w.step = resumeStep;
        }
      } catch {
        // Resume is best-effort — keep the wizard usable even if the
        // draft fetch fails.
      }
    })();
  }
}

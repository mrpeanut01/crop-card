import type { AllocationWizardState } from '../wizardState.svelte';

/** Plan-state step handlers (Phase 21 follow-up). Lives on the wizard
 *  store so an open confirm / last reset error survive step changes. */
export class PlanResetState {
  #w: AllocationWizardState;

  resetConfirmOpen = $state(false);
  resetting = $state(false);
  resetError = $state<string | null>(null);
  resetSummary = $state<Record<string, number> | null>(null);

  constructor(w: AllocationWizardState) {
    this.#w = w;
  }

  continueExistingPlan() {
    this.#w.step = 'seeds';
  }

  openResetConfirm() {
    this.resetError = null;
    this.resetSummary = null;
    this.resetConfirmOpen = true;
  }

  cancelReset() {
    this.resetConfirmOpen = false;
  }

  async confirmReset() {
    this.resetting = true;
    this.resetError = null;
    try {
      const res = await fetch('/api/plan/reset', { method: 'DELETE' });
      const body = await res.json();
      if (!res.ok) {
        this.resetError = body.error ?? `HTTP ${res.status}`;
        return;
      }
      this.resetSummary = body.removed ?? {};
      this.resetConfirmOpen = false;
      // Advance to 'seeds'. We deliberately do NOT call onCommitted here
      // (that's the parent's signal to CLOSE the wizard). Instead, refresh
      // the parent's data in-place via onRefreshParent so the wizard stays
      // open and the operator can immediately start a fresh plan.
      this.#w.step = 'seeds';
      const onRefreshParent = this.#w.props.onRefreshParent;
      if (onRefreshParent) {
        try {
          await onRefreshParent();
        } catch {
          /* refresh failures are non-fatal — wizard keeps its initial props */
        }
      }
    } catch (e) {
      this.resetError = e instanceof Error ? e.message : String(e);
    } finally {
      this.resetting = false;
    }
  }
}

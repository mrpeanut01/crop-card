import type { AllocationWizardState } from '../wizardState.svelte';
import type { PluginCandidate } from '../types';

/** Seeds-step recovery state: the #175 empty-stock refresh and the #252
 *  inline "link to crop plugin" picker. Lives on the wizard store so an
 *  open picker survives a Back/Next round trip. */
export class SeedLinkState {
  #w: AllocationWizardState;

  // #175 / CT-W-006 (Sprint 1 link-out, Sprint 3 embed) — Seeds step
  // dead-end recovery. When `eligibleStock` is empty, the empty-state
  // card lets the user open /stock/add in a new tab and then
  // refresh the wizard data in place. `seedStockRefreshing` debounces
  // the refresh button so a slow loader doesn't double-fire.
  // Spec: docs/design/almanac/direction-almanac-wizard.jsx §seeds-fallback.
  seedStockRefreshing = $state(false);

  linkPickerOpenFor = $state<string | null>(null);
  linkQuery = $state('');
  linkResults = $state<PluginCandidate[]>([]);
  linkSearching = $state(false);
  linkError = $state<string | null>(null);
  linkAssigningId = $state<string | null>(null);
  #linkDebounceHandle: ReturnType<typeof setTimeout> | null = null;

  constructor(w: AllocationWizardState) {
    this.#w = w;
  }

  async refreshSeedStock() {
    const onRefreshParent = this.#w.props.onRefreshParent;
    if (!onRefreshParent || this.seedStockRefreshing) return;
    this.seedStockRefreshing = true;
    try {
      await onRefreshParent();
    } catch {
      /* non-fatal; the wizard keeps its prior seedStock prop */
    } finally {
      this.seedStockRefreshing = false;
    }
  }

  openLinkPicker(stockItemId: string): void {
    this.linkPickerOpenFor = stockItemId;
    this.linkQuery = '';
    this.linkResults = [];
    this.linkError = null;
  }

  closeLinkPicker(): void {
    this.linkPickerOpenFor = null;
    this.linkQuery = '';
    this.linkResults = [];
    this.linkError = null;
    if (this.#linkDebounceHandle) {
      clearTimeout(this.#linkDebounceHandle);
      this.#linkDebounceHandle = null;
    }
  }

  onLinkQueryChange(): void {
    if (this.#linkDebounceHandle) clearTimeout(this.#linkDebounceHandle);
    const q = this.linkQuery.trim();
    if (q.length < 2) {
      this.linkResults = [];
      return;
    }
    this.#linkDebounceHandle = setTimeout(() => {
      void this.runLinkSearch(q);
    }, 200);
  }

  async runLinkSearch(q: string): Promise<void> {
    this.linkSearching = true;
    this.linkError = null;
    try {
      // skipWebSearch=true → local fuzzy match only, no AI quota
      // consumption while the operator types. Honors Invariant 7
      // (AI assists, never gates) — picker works without an Anthropic
      // key for any plugin already in the operator's library.
      const res = await fetch('/api/plugins/search-by-name', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ query: q, hintType: 'crop', skipWebSearch: true })
      });
      const body = await res.json();
      if (!res.ok) {
        this.linkError = body.error ?? `HTTP ${res.status}`;
        return;
      }
      this.linkResults = (body.candidates ?? []) as PluginCandidate[];
    } catch (err) {
      this.linkError = err instanceof Error ? err.message : String(err);
    } finally {
      this.linkSearching = false;
    }
  }

  async assignPluginToStock(stockItemId: string, pluginId: string): Promise<void> {
    if (this.linkAssigningId) return;
    this.linkAssigningId = stockItemId;
    this.linkError = null;
    try {
      const res = await fetch(`/api/stock/${stockItemId}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ pluginId })
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        this.linkError = body.error ?? `HTTP ${res.status}`;
        return;
      }
      this.closeLinkPicker();
      // Refresh so the seed migrates from noPluginStock → eligibleStock.
      // refreshSeedStock guards against double-fire via seedStockRefreshing.
      await this.refreshSeedStock();
    } catch (err) {
      this.linkError = err instanceof Error ? err.message : String(err);
    } finally {
      this.linkAssigningId = null;
    }
  }
}

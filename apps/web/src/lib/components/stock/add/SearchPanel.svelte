<script lang="ts">
  import { onDestroy } from 'svelte';
  import { createT } from '$lib/i18n';
  import { page } from '$app/state';
  import { Search, Loader2, Globe, Database } from 'lucide-svelte';
  import Provenance from '$lib/components/ui/Provenance.svelte';
  import type { StockEntryDraft } from '$lib/stock/normalizeStockEntry';
  import type { StockUnit } from '$lib/stock/units';
  import type { StockCategory } from '$lib/db/stock';
  import type { InventoryType } from '$lib/inventory/types';
  import { sameNameDetails } from '$lib/plugins/sameName';

  /**
   * Phase 25d (#89) — Method 2 of the 5-method add waterfall.
   *
   * Operator types a product name; client POSTs `/api/plugins/search-by-
   * name` which runs a 2-tier waterfall server-side: local fuzzy match
   * first (free, no quota), then AI web search only when no confident
   * local hit. A "Search the web" button lets the operator opt into
   * the web-search tier explicitly when local matches are weak.
   *
   * The "marketplace tier" from #89 was a stretch placeholder — no such
   * separate endpoint exists today. The current 2-tier (library → web)
   * is the waterfall.
   */

  interface SearchCandidate {
    source: 'claude-vision' | 'web-search' | 'local';
    candidate: {
      pluginId?: string;
      type?: string;
      displayName?: string;
      shortName?: string;
      defaultUnit?: string;
      activeIngredients?: ReadonlyArray<unknown>;
      approval?: { kind: 'NADA' | 'ANADA'; number: string } | null;
      [k: string]: unknown;
    } | null;
    confidence?: 'high' | 'medium' | 'low';
    guessed?: string[];
    score?: number;
  }

  interface Props {
    onSubmit: (draft: StockEntryDraft) => void | Promise<void>;
    busy?: boolean;
    /** Drives the `hintType` sent to the search endpoint so seed search
     *  hits the crop-plugin library, etc. */
    type?: InventoryType;
    /** Gates the opt-in "Search the web" tier — hidden with no key. */
    aiEnabled?: boolean;
  }

  const { onSubmit, busy = false, type, aiEnabled = false }: Props = $props();
  const tr = $derived(createT(page.data?.locale));

  // Map the inventory type onto the search endpoint's hintType enum.
  // Pesticide is ambiguous (herb/insect/fungicide) so it stays unhinted.
  const hintType = $derived(
    type === 'seed'
      ? 'crop'
      : type === 'fertility'
        ? 'fertilizer'
        : type === 'animal-health'
          ? 'animal-health'
          : undefined
  );
  const webTier = $derived(aiEnabled && type !== 'animal-health');

  let query = $state('');
  let searching = $state(false);
  let searchedWeb = $state(false);
  let candidates = $state<SearchCandidate[]>([]);
  let searchSource = $state<'local' | 'web-search' | 'mixed' | null>(null);
  let searchError = $state<string | null>(null);
  let searchMeta = $state<{
    quotaBlocked?: boolean;
    upstreamOverloaded?: boolean;
    aiUnavailable?: boolean;
    message?: string;
  } | null>(null);

  // Live local typeahead — debounce keystrokes and fire a local-only
  // (free, no-quota) query so completions appear as the operator types.
  // The web tier stays opt-in behind the button below.
  let debounceTimer: ReturnType<typeof setTimeout> | undefined;
  // Only the newest search may write results: a slow answer for an older
  // query (or one sent before the box was cleared) is dropped.
  let searchSeq = 0;
  function onQueryInput(): void {
    clearTimeout(debounceTimer);
    searchError = null;
    const q = query.trim();
    if (q.length < 2) {
      searchSeq++;
      searching = false;
      candidates = [];
      searchSource = null;
      return;
    }
    debounceTimer = setTimeout(() => void runSearch(false, true), 250);
  }
  onDestroy(() => clearTimeout(debounceTimer));

  async function runSearch(includeWeb: boolean, silent = false): Promise<void> {
    if (!silent) clearTimeout(debounceTimer);
    const q = query.trim();
    if (q.length < 2) {
      if (!silent) searchError = tr('stockui.search.min');
      return;
    }
    const seq = ++searchSeq;
    searching = true;
    if (!silent) searchError = null;
    if (includeWeb) searchedWeb = true;
    try {
      const res = await fetch('/api/plugins/search-by-name', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ query: q, hintType, skipWebSearch: !includeWeb })
      });
      const body = await res.json();
      if (seq !== searchSeq) return;
      if (!res.ok && !Array.isArray(body.candidates)) {
        if (!silent) searchError = body.error ?? tr('stockui.httpStatus', { status: res.status });
        return;
      }
      candidates = (body.candidates as SearchCandidate[]) ?? [];
      searchSource = body.source ?? null;
      searchMeta = body.meta ?? null;
    } catch (e) {
      if (seq !== searchSeq) return;
      if (!silent) searchError = e instanceof Error ? e.message : String(e);
    } finally {
      if (seq === searchSeq) searching = false;
    }
  }

  function reset() {
    searchSeq++;
    searching = false;
    candidates = [];
    searchSource = null;
    searchMeta = null;
    searchedWeb = false;
    searchError = null;
  }

  function onQueryKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter') {
      e.preventDefault();
      void runSearch(false);
    }
  }

  /** Plugin → category mapper. The plugin's `type` field maps 1:1 to
   *  StockCategory for the four input families (`herbicide`, `insecticide`,
   *  `fungicide`, `fertilizer`); `crop` plugins map to `seed`; anything
   *  else falls through to whatever the operator picks on the confirm
   *  page. */
  function categoryFromPluginType(type?: string): StockCategory | undefined {
    switch (type) {
      case 'herbicide':
      case 'insecticide':
      case 'fungicide':
      case 'fertilizer':
        return type;
      case 'crop':
        return 'seed';
      default:
        return undefined;
    }
  }

  function pickCandidate(cand: SearchCandidate): void {
    if (!cand.candidate) return;
    const c = cand.candidate;
    if (c.type === 'animal-health') {
      const health: StockEntryDraft = { source: 'plugin', displayName: c.displayName };
      if (c.approval) health.nada = { kind: c.approval.kind, number: c.approval.number };
      if (c.pluginId && c.displayName) {
        health.suggestedHealthPlugin = { pluginId: c.pluginId, displayName: c.displayName };
      }
      void onSubmit(health);
      return;
    }
    const draft: StockEntryDraft = {
      // Local matches are deterministic library hits → 'plugin' source.
      // Web-search hits used AI → 'ai' source. The Provenance addendum
      // uses these tags on per-field badges downstream.
      source: cand.source === 'local' ? 'plugin' : 'ai',
      displayName: c.displayName,
      shortName: typeof c.shortName === 'string' ? c.shortName : undefined,
      category: categoryFromPluginType(c.type),
      pluginId: c.pluginId,
      defaultUnit: c.defaultUnit as StockUnit | undefined
    };
    void onSubmit(draft);
  }

  const candidateDetails = $derived(sameNameDetails(candidates.map((c) => c.candidate ?? {})));

  const hasConfidentLocal = $derived(
    candidates.some((c) => c.source === 'local' && (c.score ?? 0) >= 0.6)
  );
</script>

<div class="search-panel">
  <p class="lede">
    {tr('stockui.search.lede')}{#if webTier}
      {tr('stockui.search.ledeAi')}{/if}
  </p>

  <div class="search-row">
    <label class="visually-hidden" for="search-input">{tr('stockui.search.productName')}</label>
    <span class="search-icon" aria-hidden="true"><Search size={18} strokeWidth={1.75} /></span>
    <input
      id="search-input"
      type="text"
      bind:value={query}
      oninput={onQueryInput}
      onkeydown={onQueryKeydown}
      maxlength="120"
      placeholder={tr('stockui.search.placeholder')}
      disabled={busy || searching}
    />
    <button type="button" onclick={() => runSearch(false)} disabled={busy || searching}>
      {searching ? tr('stockui.search.searching') : tr('stockui.search.searchLibrary')}
    </button>
  </div>

  {#if searchError}
    <p class="error" aria-live="polite">{searchError}</p>
  {/if}

  {#if searchMeta?.upstreamOverloaded}
    <p class="hint" aria-live="polite">
      {tr('stockui.search.overloaded')}
    </p>
  {:else if searchMeta?.quotaBlocked || searchMeta?.aiUnavailable}
    <p class="hint" aria-live="polite">
      {searchMeta.message ?? tr('stockui.search.quota')}
    </p>
  {/if}

  {#if candidates.length === 0 && searchSource && !searching}
    <p class="empty">
      {searchedWeb
        ? tr('stockui.search.nothingWeb', { tab: tr('inv.add.method.manual') })
        : tr('stockui.search.nothingLibrary', { tab: tr('inv.add.method.manual') })}
    </p>
  {/if}

  {#if candidates.length > 0}
    <div class="src-banner">
      {tr('stockui.search.source')}
      {#if searchSource === 'local'}
        <Database size={14} strokeWidth={1.75} />
        {tr('stockui.search.localLibrary')}
      {:else if searchSource === 'web-search'}
        <Globe size={14} strokeWidth={1.75} />
        {tr('stockui.search.claudeWeb')}
      {:else if searchSource === 'mixed'}
        <Database size={14} strokeWidth={1.75} />
        {tr('stockui.search.libraryPlus')}
        <Globe size={14} strokeWidth={1.75} />
        {tr('stockui.search.web')}
      {/if}
    </div>

    <ul class="candidates">
      {#each candidates as cand, i (i)}
        {@const c = cand.candidate}
        {@const detail = candidateDetails[i]}
        <li class="card" class:no-plugin={!c}>
          <div class="card-head">
            <div class="card-title">
              {c?.displayName ?? c?.pluginId ?? tr('stockui.search.unparsed')}
              <Provenance source={cand.source === 'local' ? 'plugin' : 'ai'} compact />
            </div>
            {#if detail}<div class="card-detail">{detail}</div>{/if}
            <div class="card-meta">
              {#if c?.type}<span class="kind">{c.type}</span>{/if}
              {#if cand.confidence}<span class="conf conf-{cand.confidence}">{cand.confidence}</span
                >{/if}
            </div>
          </div>
          {#if cand.guessed && cand.guessed.length > 0}
            <p class="guessed">
              {tr('stockui.search.inferred', { list: cand.guessed.join(', ') })}
            </p>
          {/if}
          <div class="card-actions">
            <button
              type="button"
              class="pick"
              disabled={busy || !c}
              onclick={() => pickCandidate(cand)}
            >
              {tr('stockui.search.pick')}
            </button>
          </div>
        </li>
      {/each}
    </ul>
  {/if}

  {#if candidates.length > 0 && !hasConfidentLocal && !searchedWeb && webTier}
    <div class="web-prompt">
      <p>{tr('stockui.search.webPrompt')}</p>
      <button type="button" onclick={() => runSearch(true)} disabled={busy || searching}>
        {#if searching}
          <Loader2 size={14} class="spin" /> {tr('stockui.search.searching')}
        {:else}
          <Globe size={14} /> {tr('stockui.search.searchWeb')}
        {/if}
      </button>
    </div>
  {/if}

  {#if candidates.length > 0}
    <button type="button" class="reset" onclick={reset}>{tr('stockui.search.startOver')}</button>
  {/if}
</div>

<style>
  .search-panel {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .lede {
    margin: 0 0 4px;
    font-size: 13px;
    color: var(--color-ink-soft);
    line-height: 1.45;
  }
  .search-row {
    display: flex;
    align-items: center;
    gap: 8px;
    background: var(--color-paper);
    border: 1px solid var(--color-divider);
    border-radius: var(--radius-input, 6px);
    padding: 4px 4px 4px 10px;
  }
  .search-row input {
    flex: 1 1 auto;
    border: 0;
    background: transparent;
    font-family: inherit;
    font-size: 14px;
    padding: 9px 6px;
    min-height: 36px;
    color: var(--color-ink);
  }
  .search-row input:focus {
    outline: none;
  }
  .search-icon {
    display: grid;
    place-items: center;
    color: var(--color-ink-muted);
  }
  .search-row button {
    background: var(--color-forest-deep);
    color: var(--color-paper);
    border: 0;
    padding: 8px 14px;
    border-radius: var(--radius-input, 6px);
    font-size: 13px;
    font-weight: 600;
    font-family: inherit;
    cursor: pointer;
    min-height: 36px;
  }
  .search-row button:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }
  .visually-hidden {
    position: absolute;
    width: 1px;
    height: 1px;
    margin: -1px;
    padding: 0;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    border: 0;
  }
  .error {
    margin: 0;
    color: var(--color-rust, #ba4b38);
    font-size: 13px;
  }
  .hint {
    margin: 0;
    padding: 8px 12px;
    background: rgba(212, 167, 92, 0.12);
    color: var(--color-ink-soft);
    border-radius: 4px;
    font-size: 12.5px;
  }
  .empty {
    margin: 0;
    font-size: 13px;
    color: var(--color-ink-soft);
    font-style: italic;
  }
  .src-banner {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-size: 12px;
    color: var(--color-ink-muted);
    padding: 4px 10px;
    background: var(--color-cream);
    border-radius: 999px;
    align-self: flex-start;
  }
  .candidates {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .card {
    background: var(--color-paper);
    border: 1px solid var(--color-divider);
    border-radius: var(--radius-card, 8px);
    padding: 12px 14px;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .card.no-plugin {
    opacity: 0.6;
  }
  .card-head {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .card-title {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 14px;
    font-weight: 600;
    color: var(--color-ink);
  }
  .card-detail {
    font-size: 12.5px;
    color: var(--color-ink-soft);
  }
  .card-meta {
    display: flex;
    gap: 8px;
    font-size: 11.5px;
    color: var(--color-ink-soft);
    flex-wrap: wrap;
  }
  .kind {
    text-transform: capitalize;
  }
  .conf {
    padding: 1px 6px;
    border-radius: 999px;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    font-weight: 700;
  }
  .conf-high {
    background: rgba(44, 82, 55, 0.12);
    color: var(--color-forest-deep);
  }
  .conf-medium {
    background: rgba(212, 167, 92, 0.18);
    color: var(--color-ink);
  }
  .conf-low {
    background: rgba(186, 75, 56, 0.12);
    color: var(--color-rust, #ba4b38);
  }
  .guessed {
    margin: 0;
    font-size: 12px;
    color: var(--color-ink-soft);
    font-style: italic;
  }
  .card-actions {
    display: flex;
    justify-content: flex-end;
  }
  .pick {
    background: var(--color-forest-deep);
    color: var(--color-paper);
    border: 0;
    padding: 7px 16px;
    border-radius: var(--radius-input, 6px);
    font-size: 13px;
    font-weight: 600;
    font-family: inherit;
    cursor: pointer;
    min-height: 34px;
  }
  .pick:disabled {
    opacity: 0.55;
    cursor: not-allowed;
  }
  .web-prompt {
    background: var(--color-cream);
    border: 1px dashed var(--color-divider);
    border-radius: var(--radius-card, 8px);
    padding: 12px 14px;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .web-prompt p {
    margin: 0;
    font-size: 13px;
    color: var(--color-ink-soft);
  }
  .web-prompt button {
    align-self: flex-start;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    background: var(--color-paper);
    border: 1px solid var(--color-divider);
    padding: 7px 14px;
    border-radius: var(--radius-input, 6px);
    font-size: 13px;
    font-weight: 600;
    color: var(--color-ink);
    cursor: pointer;
    min-height: 34px;
  }
  .web-prompt button:disabled {
    opacity: 0.55;
    cursor: not-allowed;
  }
  .reset {
    align-self: flex-start;
    background: transparent;
    border: 0;
    color: var(--color-ink-muted);
    font-family: inherit;
    font-size: 12px;
    text-decoration: underline;
    cursor: pointer;
  }
</style>

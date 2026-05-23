<script lang="ts">
  import { goto, invalidateAll } from '$app/navigation';
  import GroupCodeBadge from '$lib/components/GroupCodeBadge.svelte';
  import LabelCapture from '$lib/components/LabelCapture.svelte';
  import PluginCandidateCard from '$lib/components/PluginCandidateCard.svelte';
  import ReceiptScan from '$lib/components/ReceiptScan.svelte';

  let { data } = $props();

  type Candidate = {
    source: 'claude-vision' | 'web-search' | 'local';
    candidate: Record<string, unknown> | null;
    validation: { ok: boolean; schemaIssues: { path: string; message: string }[]; bypassIssues: { path: string; message: string }[] };
    confidence?: 'high' | 'medium' | 'low';
    guessed?: string[];
    citations?: { url: string; title?: string }[];
    score?: number;
  };

  let showLabelCapture = $state(false);
  let showReceiptScan = $state(false);
  let scanError = $state<string | null>(null);
  let scanCandidate = $state<Candidate | null>(null);
  let scanBusy = $state(false);

  let searchQuery = $state('');
  let searchCandidates = $state<Candidate[]>([]);
  let searchSource = $state<'local' | 'web-search' | 'mixed' | null>(null);
  let searchBusy = $state(false);
  let searchError = $state<string | null>(null);
  /** Live status from the AI Lookup SSE stream — updates as Claude
   *  triggers web_search → returns sources → parses candidates. */
  let searchStatus = $state<string | null>(null);
  let searchDebounceHandle: ReturnType<typeof setTimeout> | undefined;

  function openCapture() {
    scanError = null;
    scanCandidate = null;
    showLabelCapture = true;
  }

  async function onLabelCaptured(base64: string) {
    showLabelCapture = false;
    scanBusy = true;
    scanError = null;
    try {
      const res = await fetch('/api/plugins/scan-label', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image: base64 })
      });
      const out = await res.json();
      if (!res.ok) {
        scanError = out.error ?? `HTTP ${res.status}`;
        return;
      }
      if (out.found === false || !out.candidate) {
        scanError = 'Claude could not identify a product on this label. Try a clearer photo or the authoring form directly.';
        return;
      }
      scanCandidate = out.candidate;
    } catch (e) {
      scanError = e instanceof Error ? e.message : String(e);
    } finally {
      scanBusy = false;
    }
  }

  function onSearchInput() {
    clearTimeout(searchDebounceHandle);
    if (searchQuery.trim().length < 3) {
      searchCandidates = [];
      searchSource = null;
      searchError = null;
      return;
    }
    searchDebounceHandle = setTimeout(runSearch, 400);
  }

  async function runSearch(opts: { useAi?: boolean } = {}) {
    searchBusy = true;
    searchError = null;
    searchSource = null;
    searchStatus = opts.useAi ? 'Connecting to Claude…' : 'Searching local registry…';

    if (opts.useAi) {
      await runAiLookupStreaming();
      return;
    }

    try {
      const res = await fetch('/api/plugins/search-by-name', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query: searchQuery,
          skipWebSearch: true
        })
      });
      const out = await res.json();
      if (!res.ok) {
        searchError = out.error ?? `HTTP ${res.status}`;
        return;
      }
      searchCandidates = out.candidates ?? [];
      searchSource = out.source ?? null;
    } catch (e) {
      searchError = e instanceof Error ? e.message : String(e);
    } finally {
      searchBusy = false;
      searchStatus = null;
    }
  }

  /** SSE consumer for the AI Lookup path. Reads `data: <json>\n\n` frames
   *  and updates `searchStatus` as Claude makes progress through its
   *  web_search calls + text generation. */
  async function runAiLookupStreaming() {
    try {
      const res = await fetch('/api/plugins/search-by-name/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: searchQuery })
      });
      if (!res.ok || !res.body) {
        searchError = `HTTP ${res.status}`;
        return;
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n\n');
        buffer = lines.pop() ?? '';
        for (const frame of lines) {
          const line = frame.split('\n').find((l) => l.startsWith('data: '));
          if (!line) continue;
          const json = line.slice(6).trim();
          if (!json) continue;
          let event: Record<string, unknown>;
          try {
            event = JSON.parse(json);
          } catch {
            continue;
          }
          handleStreamEvent(event);
        }
      }
    } catch (e) {
      searchError = e instanceof Error ? e.message : String(e);
    } finally {
      searchBusy = false;
      searchStatus = null;
    }
  }

  function handleStreamEvent(event: Record<string, unknown>) {
    const phase = event.phase as string;
    if (phase === 'complete') {
      searchCandidates = (event.candidates as Candidate[]) ?? [];
      searchSource = 'web-search';
    } else if (phase === 'error') {
      searchError = (event.message as string) ?? 'unknown error';
    } else if (typeof event.message === 'string') {
      searchStatus = event.message;
    }
  }

  function useCandidate(plugin: Record<string, unknown>) {
    if (plugin.type && plugin.pluginId && typeof plugin.pluginId === 'string') {
      const existing = data.records.find((r) => r.pluginId === plugin.pluginId);
      if (existing) {
        goto(`/plugins/${encodeURIComponent(plugin.pluginId)}`);
        return;
      }
    }
    const prefill = encodeURIComponent(JSON.stringify(plugin));
    goto(`/plugins/new?prefill=${prefill}`);
  }

  let typeFilter = $state<'all' | 'crop' | 'herbicide' | 'insecticide' | 'fungicide' | 'fertilizer' | 'companion'>('all');

  const filtered = $derived(
    typeFilter === 'all' ? data.records : data.records.filter((r) => r.type === typeFilter)
  );

  // ─── Bulk selection ─────────────────────────────────────────────────
  let selectedIds = $state<Set<string>>(new Set());
  const allFilteredSelected = $derived(
    filtered.length > 0 && filtered.every((r) => selectedIds.has(r.pluginId))
  );
  const someFilteredSelected = $derived(
    filtered.some((r) => selectedIds.has(r.pluginId))
  );

  function toggleSelect(id: string) {
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    selectedIds = next;
  }
  function selectAllFiltered() {
    const next = new Set(selectedIds);
    if (allFilteredSelected) {
      for (const r of filtered) next.delete(r.pluginId);
    } else {
      for (const r of filtered) next.add(r.pluginId);
    }
    selectedIds = next;
  }
  function clearSelection() {
    selectedIds = new Set();
  }

  async function bulkDownload() {
    const ids = Array.from(selectedIds);
    for (let i = 0; i < ids.length; i++) {
      const a = document.createElement('a');
      a.href = `/api/plugins/${encodeURIComponent(ids[i])}/export`;
      a.download = `${ids[i]}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      // small delay between triggers so browsers don't squash them.
      if (i < ids.length - 1) await new Promise((r) => setTimeout(r, 120));
    }
  }

  type RejectIssue = { path: string; message: string };
  type RejectReason = {
    title: string;
    code: 'schema' | 'bypass' | 'other';
    issues: RejectIssue[];
  };

  let uploadJson = $state('');
  let uploadSuccess = $state<string | null>(null);
  let uploading = $state(false);
  let reject = $state<RejectReason | null>(null);

  async function uploadPlugin() {
    uploadSuccess = null;
    reject = null;
    if (!uploadJson.trim()) return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(uploadJson);
    } catch (e) {
      reject = {
        title: 'JSON parse error',
        code: 'other',
        issues: [{ path: '(input)', message: e instanceof Error ? e.message : String(e) }]
      };
      return;
    }
    uploading = true;
    try {
      const res = await fetch('/api/plugins/upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(parsed)
      });
      const out = await res.json();
      if (!res.ok) {
        reject = {
          title:
            out.code === 'bypass'
              ? 'Plugin rejected — would override a hard-locked safety rule'
              : out.code === 'schema'
                ? 'Plugin rejected — schema validation failed'
                : `Plugin rejected (HTTP ${res.status})`,
          code: out.code ?? 'other',
          issues:
            Array.isArray(out.issues) && out.issues.length > 0
              ? out.issues
              : [{ path: '', message: out.error ?? `HTTP ${res.status}` }]
        };
        return;
      }
      uploadSuccess = `Saved as ${out.pluginId} (${out.path})`;
      uploadJson = '';
      await invalidateAll();
    } catch (e) {
      reject = {
        title: 'Network error',
        code: 'other',
        issues: [{ path: '', message: e instanceof Error ? e.message : String(e) }]
      };
    } finally {
      uploading = false;
    }
  }

  function ackReject() {
    reject = null;
  }

  function handleFile(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      uploadJson = String(reader.result ?? '');
    };
    reader.readAsText(file);
  }
</script>

<h1>Plugin Manager</h1>
<p class="lede">
  All crop, herbicide, insecticide, and companion knowledge lives in data-only JSON files under <code
    >plugins/</code
  >. The kernel reads them through a registry that validates schema + checks for bypass attempts at
  registration. Loaded {data.records.length} plugin{data.records.length === 1 ? '' : 's'}.
</p>

{#if data.canEdit}
  <section class="card add-paths">
    <h2>Add a product</h2>
    <div class="add-row">
      <button class="primary-cta wide" onclick={openCapture} disabled={scanBusy}>
        {scanBusy ? 'Reading label…' : '📷 Scan label'}
      </button>
      <button class="primary-cta wide" onclick={() => (showReceiptScan = true)}>
        🧾 Scan receipt
      </button>
      <a class="primary-cta wide" href="/plugins/new">✎ Manual entry</a>
    </div>
    <div class="search-row">
      <label for="plugin-search-input" class="search-label">
        Or type a product name — we'll search the registry first, then the web:
      </label>
      <div class="search-input-row">
        <input
          id="plugin-search-input"
          type="text"
          bind:value={searchQuery}
          oninput={onSearchInput}
          placeholder="e.g. Roundup PowerMax, Concord grape, Bordeaux mix"
          autocomplete="off"
        />
        <button
          class="ai-lookup"
          onclick={() => runSearch({ useAi: true })}
          disabled={searchBusy || searchQuery.trim().length < 3}
          title="Use AI to look up product details from the web"
        >
          <span class="ai-icon" aria-hidden="true">✦</span>
          AI Lookup
        </button>
      </div>
      {#if searchError}<p class="warn-inline">{searchError}</p>{/if}
      {#if searchBusy}
        <p class="muted live-status">
          <span class="spinner" aria-hidden="true"></span>
          {searchStatus ?? 'Searching…'}
        </p>
      {/if}
      {#if !searchBusy && searchSource}<p class="muted source-line">Source: {searchSource}</p>{/if}
      {#each searchCandidates as c, i (c.candidate?.pluginId ?? `cand-${i}`)}
        <PluginCandidateCard candidate={c} onUse={useCandidate} />
      {/each}
    </div>
    {#if scanError}
      <p class="warn-inline">{scanError}</p>
    {/if}
    {#if scanCandidate}
      <PluginCandidateCard
        candidate={scanCandidate}
        onUse={useCandidate}
        onSkip={() => (scanCandidate = null)}
      />
    {/if}
  </section>
{:else}
  <p class="role-notice">
    📚 <strong>View only</strong> — helper role can browse + audit plugins. Sign in as Owner to author
    or upload new ones.
  </p>
{/if}

{#if showLabelCapture}
  <LabelCapture onCapture={onLabelCaptured} onClose={() => (showLabelCapture = false)} />
{/if}

{#if showReceiptScan}
  <ReceiptScan onClose={() => (showReceiptScan = false)} />
{/if}

<p class="community-link">
  Looking to share or discover plugins? See the <a href="/plugins/community">community plugins</a>
  page.
</p>

{#if data.failures.length > 0}
  <section class="alert">
    <strong>⚠ {data.failures.length} plugin file(s) failed to load:</strong>
    <ul>
      {#each data.failures as f}<li>{f}</li>{/each}
    </ul>
  </section>
{/if}

<section class="card list-card">
  <header class="list-header">
    <h2>Registered plugins</h2>
    <div class="filter-tabs">
      {#each ['all', 'crop', 'herbicide', 'insecticide', 'fungicide', 'fertilizer', 'companion'] as t (t)}
        <button
          class="filter-tab"
          class:active={typeFilter === t}
          onclick={() => (typeFilter = t as typeof typeFilter)}
        >
          {t}
          {#if t === 'all'}<span class="tab-count">{data.records.length}</span>{:else}<span class="tab-count">{data.records.filter((r) => r.type === t).length}</span>{/if}
        </button>
      {/each}
    </div>
  </header>

  {#if selectedIds.size > 0}
    <div class="bulk-bar" role="region" aria-label="Bulk actions">
      <span class="bulk-count">{selectedIds.size} selected</span>
      <button class="bulk-action" onclick={bulkDownload}>↓ Download JSON</button>
      <button class="bulk-clear" onclick={clearSelection}>Clear</button>
    </div>
  {/if}

  <div class="list-toolbar">
    <label class="select-all">
      <input
        type="checkbox"
        checked={allFilteredSelected}
        indeterminate={someFilteredSelected && !allFilteredSelected}
        onchange={selectAllFiltered}
      />
      <span>{filtered.length} {typeFilter === 'all' ? 'plugins' : typeFilter + ' plugins'}</span>
    </label>
  </div>

  <ul class="plugins">
    {#each filtered as r (r.pluginId)}
      <li class="row" class:selected={selectedIds.has(r.pluginId)}>
        <input
          type="checkbox"
          class="row-check"
          checked={selectedIds.has(r.pluginId)}
          onchange={() => toggleSelect(r.pluginId)}
          aria-label={`Select ${r.displayName}`}
        />
        <a class="row-main" href="/plugins/{encodeURIComponent(r.pluginId)}">
          <div class="row-line1">
            <strong class="name">{r.displayName}</strong>
            <span class="type-badge type-{r.type}">{r.type}</span>
            {#each r.groupCodes as gc}
              <GroupCodeBadge kind={gc.kind} group={gc.group} />
            {/each}
            <span class="version">v{r.version}</span>
            {#if r.historyCount > 1}
              <span class="history-chip" title="Number of versions on record">{r.historyCount} versions</span>
            {/if}
          </div>
          <div class="row-line2">
            <span class="summary">{r.summary}</span>
            {#if r.lastChangedAt}
              <span class="updated" title={new Date(r.lastChangedAt).toISOString()}>
                {new Date(r.lastChangedAt).toISOString().slice(0, 10)}
              </span>
            {/if}
          </div>
        </a>
        <a
          class="row-download"
          href="/api/plugins/{encodeURIComponent(r.pluginId)}/export"
          download
          title="Download JSON"
          aria-label={`Download ${r.displayName}`}
          onclick={(e) => e.stopPropagation()}
        >
          ↓
        </a>
      </li>
    {/each}
    {#if filtered.length === 0}
      <li class="empty-row">No plugins match this filter.</li>
    {/if}
  </ul>
</section>

{#if data.canEdit}
  <section class="card">
    <details>
      <summary>Advanced: upload raw plugin JSON</summary>
      <p class="lede">
        Paste a JSON document or upload a <code>.json</code> file. The registry will validate
        against the schema + bypass matrix. Most authors should use the
        <a href="/plugins/new">guided wizard</a> instead.
      </p>
      <input type="file" accept="application/json" onchange={handleFile} />
      <textarea
        rows="10"
        bind:value={uploadJson}
        placeholder={'{ "pluginId": "…", "type": "crop", "displayName": "…", "version": "1.0.0", "cropFamily": "corn" }'}
      ></textarea>
      <button class="primary" onclick={uploadPlugin} disabled={uploading || !uploadJson.trim()}>
        {uploading ? 'Uploading…' : 'Upload'}
      </button>
      {#if uploadSuccess}<p class="success">{uploadSuccess}</p>{/if}
    </details>
  </section>
{/if}

{#if reject}
  <div
    class="reject-backdrop"
    role="dialog"
    aria-modal="true"
    aria-labelledby="reject-title"
    onclick={(e) => e.target === e.currentTarget && ackReject()}
    onkeydown={(e) => e.key === 'Escape' && ackReject()}
    tabindex="-1"
  >
    <div class="reject-modal {reject.code}">
      <h2 id="reject-title">⛔ {reject.title}</h2>
      {#if reject.code === 'bypass'}
        <p class="why">
          The plugin's declared chemistry would kill a crop family it claims safety on. The kernel's
          kill matrix is hardcoded in
          <code>cropFamilyLethality.ts</code> and cannot be overridden by any plugin file (NFR-09).
          This is the system working — fix the plugin's <code>safeForCropPluginIds</code> or its
          <code>chemistryClass</code>, then try again.
        </p>
      {:else if reject.code === 'schema'}
        <p class="why">
          The plugin doesn't conform to the schema. See the field-level messages below.
        </p>
      {/if}
      <ul class="issues">
        {#each reject.issues as i}
          <li>
            {#if i.path}<code>{i.path}</code>{/if}
            <span>{i.message}</span>
          </li>
        {/each}
      </ul>
      <button class="ack" onclick={ackReject}>Got it</button>
    </div>
  </div>
{/if}

<style>
  h1 {
    margin: 0 0 0.25rem;
  }
  .lede {
    color: #555;
    margin: 0 0 1.5rem;
  }
  .card {
    background: white;
    border-radius: 8px;
    padding: 1rem 1.25rem;
    margin-bottom: 1rem;
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.05);
  }
  .card h2 {
    margin: 0 0 0.75rem;
    font-size: 1rem;
    color: #1f5e3a;
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }
  .alert {
    background: #fce8e8;
    color: #b00020;
    padding: 0.75rem 1rem;
    border-radius: 4px;
    border-left: 4px solid #b00020;
    margin-bottom: 1rem;
  }
  .list-card {
    padding: 0;
    overflow: hidden;
  }
  .list-header {
    padding: 1rem 1.25rem 0.75rem;
    border-bottom: 1px solid #eef0ee;
    display: flex;
    align-items: center;
    gap: 1rem;
    flex-wrap: wrap;
    justify-content: space-between;
  }
  .list-header h2 {
    margin: 0;
    font-size: 1rem;
    color: #1f5e3a;
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }
  .filter-tabs {
    display: flex;
    gap: 0.25rem;
    flex-wrap: wrap;
  }
  .filter-tab {
    background: transparent;
    border: 0;
    padding: 0.35rem 0.65rem;
    border-radius: 4px;
    font: inherit;
    font-size: 0.85rem;
    color: #555;
    cursor: pointer;
    text-transform: capitalize;
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
  }
  .filter-tab:hover {
    background: #f3f9f5;
    color: #1f5e3a;
  }
  .filter-tab.active {
    background: #1f5e3a;
    color: white;
  }
  .filter-tab.active .tab-count {
    background: rgba(255, 255, 255, 0.25);
    color: white;
  }
  .tab-count {
    background: #eef0ee;
    color: #555;
    border-radius: 8px;
    padding: 0 0.4rem;
    font-size: 0.72rem;
    font-weight: 600;
    min-width: 1.5rem;
    text-align: center;
  }
  .bulk-bar {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    padding: 0.55rem 1.25rem;
    background: #1f5e3a;
    color: white;
  }
  .bulk-count {
    font-weight: 600;
    font-size: 0.9rem;
  }
  .bulk-action {
    background: white;
    color: #1f5e3a;
    border: 0;
    padding: 0.3rem 0.75rem;
    border-radius: 4px;
    font: inherit;
    font-weight: 600;
    font-size: 0.85rem;
    cursor: pointer;
  }
  .bulk-action:hover {
    background: #e7f1ea;
  }
  .bulk-clear {
    background: transparent;
    border: 0;
    color: white;
    cursor: pointer;
    font: inherit;
    font-size: 0.85rem;
    text-decoration: underline;
    padding: 0.3rem 0.4rem;
    margin-left: auto;
  }
  .list-toolbar {
    padding: 0.5rem 1.25rem;
    border-bottom: 1px solid #eef0ee;
    background: #fafdfb;
  }
  .select-all {
    display: inline-flex;
    align-items: center;
    gap: 0.5rem;
    font-size: 0.8rem;
    color: #555;
    cursor: pointer;
  }
  .select-all input {
    margin: 0;
    width: 16px;
    height: 16px;
    cursor: pointer;
  }
  .plugins {
    list-style: none;
    padding: 0;
    margin: 0;
  }
  .row {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    padding: 0.55rem 1.25rem;
    border-bottom: 1px solid #eef0ee;
    transition: background-color 0.1s ease;
  }
  .row:last-child {
    border-bottom: 0;
  }
  .row:hover {
    background: #fafdfb;
  }
  .row.selected {
    background: #f3f9f5;
  }
  .row-check {
    margin: 0;
    width: 16px;
    height: 16px;
    cursor: pointer;
    flex: 0 0 auto;
  }
  .row-main {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 0.15rem;
    text-decoration: none;
    color: inherit;
  }
  .row-line1 {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    flex-wrap: nowrap;
    overflow: hidden;
  }
  .row-line1 .name {
    color: #1a2e1a;
    font-size: 0.95rem;
    font-weight: 600;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    min-width: 0;
  }
  .row-main:hover .name {
    color: #1f5e3a;
    text-decoration: underline;
  }
  .row-line2 {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    color: #666;
    font-size: 0.82rem;
  }
  .row-line2 .summary {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .row-line2 .updated {
    color: #999;
    font-variant-numeric: tabular-nums;
    flex: 0 0 auto;
  }
  .row-download {
    flex: 0 0 auto;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 32px;
    height: 32px;
    border-radius: 4px;
    color: #1f5e3a;
    text-decoration: none;
    font-size: 1.05rem;
    font-weight: 700;
    transition: background-color 0.1s ease;
  }
  .row-download:hover {
    background: #e7f1ea;
  }
  .empty-row {
    padding: 1.5rem 1.25rem;
    color: #777;
    font-style: italic;
    text-align: center;
  }
  .type-badge {
    padding: 0.05rem 0.4rem;
    border-radius: 3px;
    font-size: 0.7rem;
    font-weight: 700;
    text-transform: uppercase;
    color: white;
    letter-spacing: 0.5px;
    flex: 0 0 auto;
  }
  .type-crop { background: #1f5e3a; }
  .type-herbicide { background: #b00020; }
  .type-insecticide { background: #b35900; }
  .type-fungicide { background: #4a2c83; }
  .type-fertilizer { background: #1c5fa6; }
  .type-companion { background: #6b3fa0; }
  .version {
    color: #888;
    font-size: 0.75rem;
    font-variant-numeric: tabular-nums;
    flex: 0 0 auto;
    margin-left: auto;
  }
  .history-chip {
    font-size: 0.65rem;
    color: #8a5a00;
    background: #fff4d8;
    padding: 0 0.35rem;
    border-radius: 3px;
    flex: 0 0 auto;
  }
  .link {
    background: none;
    border: none;
    color: #1f5e3a;
    cursor: pointer;
    text-decoration: underline;
    padding: 0;
    font: inherit;
  }
  .link.download {
    text-decoration: none;
    background: #e7f1ea;
    padding: 0.3rem 0.6rem;
    border-radius: 4px;
    font-weight: 600;
  }
  .link.download:hover {
    background: #d4e5db;
  }
  textarea {
    width: 100%;
    box-sizing: border-box;
    padding: 0.6rem;
    border: 2px solid #d0d7d0;
    border-radius: 4px;
    font-family: monospace;
    font-size: 0.9rem;
    margin: 0.5rem 0;
  }
  input[type='file'] {
    padding: 0.4rem 0;
  }
  .primary {
    background: #1f5e3a;
    color: white;
    border: none;
    border-radius: 6px;
    padding: 0.75rem 1.25rem;
    font-weight: 600;
    cursor: pointer;
    min-height: 48px;
  }
  .primary:disabled {
    background: #999;
    cursor: not-allowed;
  }
  .success {
    color: #1f5e3a;
  }

  .primary-cta {
    display: block;
    background: #1f5e3a;
    color: white;
    padding: 1rem 1.5rem;
    border-radius: 8px;
    text-decoration: none;
    font-weight: 600;
    font-size: 1.05rem;
    text-align: center;
    margin: 0 0 1rem;
    min-height: 56px;
    line-height: 1.4;
  }
  .primary-cta:hover {
    background: #16472a;
  }
  .primary-cta.wide {
    flex: 1;
    border: 0;
    cursor: pointer;
    font: inherit;
    font-weight: 600;
    font-size: 1.05rem;
  }
  .primary-cta:disabled {
    background: #888;
    cursor: not-allowed;
  }
  .add-paths {
    background: #fafdfb;
  }
  .add-row {
    display: flex;
    gap: 0.75rem;
    flex-wrap: wrap;
    margin-bottom: 1rem;
  }
  .search-row {
    margin-top: 0.5rem;
  }
  .search-label {
    display: block;
    color: #444;
    margin-bottom: 0.4rem;
    font-size: 0.9rem;
  }
  .search-input-row {
    display: flex;
    gap: 0.5rem;
    align-items: stretch;
  }
  .search-input-row input {
    flex: 1;
    padding: 0.55rem 0.75rem;
    border: 2px solid #d0d7d0;
    border-radius: 4px;
    font: inherit;
    min-height: 48px;
  }
  .search-input-row button.ai-lookup {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    background: linear-gradient(135deg, #6d28d9 0%, #2563eb 100%);
    border: 0;
    color: white;
    padding: 0 1.1rem;
    border-radius: 4px;
    font-weight: 600;
    cursor: pointer;
    min-height: 48px;
    font: inherit;
    font-weight: 600;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.15);
    transition: filter 0.12s ease, box-shadow 0.12s ease;
  }
  .search-input-row button.ai-lookup:hover {
    filter: brightness(1.08);
    box-shadow: 0 2px 6px rgba(0, 0, 0, 0.2);
  }
  .search-input-row button.ai-lookup:disabled {
    background: #a8a8a8;
    cursor: not-allowed;
    box-shadow: none;
    filter: none;
  }
  .search-input-row button.ai-lookup .ai-icon {
    font-size: 1.05rem;
    line-height: 1;
    text-shadow: 0 0 6px rgba(255, 255, 255, 0.5);
  }
  .warn-inline {
    color: #b00020;
    background: #fce8e8;
    padding: 0.4rem 0.6rem;
    border-radius: 3px;
    margin: 0.5rem 0;
    font-size: 0.85rem;
  }
  .muted {
    color: #777;
    font-size: 0.85rem;
    margin: 0.3rem 0;
  }
  .source-line {
    text-transform: uppercase;
    letter-spacing: 0.5px;
    font-size: 0.75rem;
  }
  .live-status {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    color: #1f5e3a;
    font-style: italic;
  }
  .spinner {
    width: 14px;
    height: 14px;
    border: 2px solid rgba(31, 94, 58, 0.25);
    border-top-color: #1f5e3a;
    border-radius: 50%;
    animation: spin 0.7s linear infinite;
    flex: 0 0 auto;
  }
  @keyframes spin {
    to { transform: rotate(360deg); }
  }
  details summary {
    cursor: pointer;
    color: #1f5e3a;
    font-weight: 600;
    padding: 0.25rem 0;
    list-style: revert;
  }
  details[open] summary {
    margin-bottom: 0.75rem;
  }
  .role-notice {
    background: #fff8ec;
    color: #b35900;
    border-left: 4px solid #b35900;
    padding: 0.75rem 1rem;
    border-radius: 4px;
    margin-bottom: 1rem;
  }
  .community-link {
    background: #f5f7f4;
    padding: 0.6rem 0.9rem;
    border-radius: 4px;
    color: #444;
    font-size: 0.9rem;
    margin-bottom: 1rem;
  }
  .community-link a {
    color: #1f5e3a;
    font-weight: 600;
  }

  .reject-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.5);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 1000;
    padding: 1rem;
  }
  .reject-modal {
    background: white;
    border-radius: 8px;
    padding: 1.5rem;
    max-width: 600px;
    width: 100%;
    border-top: 6px solid #b00020;
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.2);
  }
  .reject-modal.schema {
    border-top-color: #b35900;
  }
  .reject-modal.other {
    border-top-color: #555;
  }
  .reject-modal h2 {
    margin: 0 0 0.75rem;
    color: #b00020;
    font-size: 1.2rem;
  }
  .reject-modal.schema h2 {
    color: #b35900;
  }
  .reject-modal.other h2 {
    color: #555;
  }
  .reject-modal .why {
    background: #fff8ec;
    padding: 0.75rem;
    border-radius: 4px;
    margin: 0 0 1rem;
    font-size: 0.9rem;
    line-height: 1.5;
  }
  .reject-modal .why code {
    background: white;
    padding: 0.05rem 0.4rem;
    border-radius: 3px;
    font-size: 0.8rem;
  }
  .reject-modal .issues {
    list-style: none;
    padding: 0;
    margin: 0 0 1rem;
  }
  .reject-modal .issues li {
    background: #fce8e8;
    padding: 0.5rem 0.75rem;
    border-radius: 4px;
    margin-bottom: 0.4rem;
    border-left: 4px solid #b00020;
  }
  .reject-modal .issues code {
    background: white;
    color: #b00020;
    padding: 0.05rem 0.4rem;
    border-radius: 3px;
    font-size: 0.8rem;
    margin-right: 0.5rem;
  }
  .reject-modal .ack {
    background: #1f5e3a;
    color: white;
    border: none;
    border-radius: 6px;
    padding: 0.9rem 1.5rem;
    font-weight: 600;
    cursor: pointer;
    width: 100%;
    min-height: 56px;
    font-size: 1rem;
  }
</style>

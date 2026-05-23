<script lang="ts">
  type Issue = { path: string; message: string };
  type Validation = { ok: boolean; schemaIssues: Issue[]; bypassIssues: Issue[] };
  type Candidate = {
    source: 'claude-vision' | 'web-search' | 'local';
    candidate: Record<string, unknown> | null;
    validation: Validation;
    confidence?: 'high' | 'medium' | 'low';
    guessed?: string[];
    citations?: Array<{ url: string; title?: string }>;
    score?: number;
  };

  let {
    candidate,
    onUse,
    onSkip
  }: {
    candidate: Candidate;
    /** Open the prefilled authoring form. */
    onUse: (plugin: Record<string, unknown>) => void;
    onSkip?: () => void;
  } = $props();

  const plugin = $derived(candidate.candidate ?? null);
  const sourceLabel = $derived(
    candidate.source === 'claude-vision'
      ? '📷 Label scan'
      : candidate.source === 'web-search'
        ? '🌐 Web search'
        : '📚 Local match'
  );
  const hasIssues = $derived(
    !candidate.validation.ok &&
      (candidate.validation.schemaIssues.length > 0 ||
        candidate.validation.bypassIssues.length > 0)
  );
  const issues = $derived([
    ...candidate.validation.bypassIssues.map((i) => ({ ...i, kind: 'bypass' as const })),
    ...candidate.validation.schemaIssues.map((i) => ({ ...i, kind: 'schema' as const }))
  ]);
</script>

<article class="card" class:invalid={hasIssues}>
  <header>
    <span class="source">{sourceLabel}</span>
    {#if candidate.confidence}
      <span class="confidence confidence-{candidate.confidence}">{candidate.confidence} confidence</span>
    {/if}
    {#if typeof candidate.score === 'number'}
      <span class="score" title="Fuzzy match score">{Math.round(candidate.score * 100)}%</span>
    {/if}
  </header>

  {#if plugin}
    <h3>
      {plugin.displayName as string}
      <code class="kind">{plugin.type as string}</code>
    </h3>
    <code class="id">{plugin.pluginId as string}</code>
    <small class="version">v{plugin.version as string}</small>

    {#if candidate.guessed && candidate.guessed.length > 0}
      <p class="guessed">
        <strong>Guessed:</strong>
        {#each candidate.guessed as f, i}
          <code>{f}</code>{i < candidate.guessed.length - 1 ? ',' : ''}
        {/each}
        — verify before commit.
      </p>
    {/if}

    {#if candidate.citations && candidate.citations.length > 0}
      <details>
        <summary>{candidate.citations.length} citation{candidate.citations.length === 1 ? '' : 's'}</summary>
        <ul class="citations">
          {#each candidate.citations as c}
            <li><a href={c.url} target="_blank" rel="noopener">{c.title ?? c.url}</a></li>
          {/each}
        </ul>
      </details>
    {/if}

    {#if hasIssues}
      <div class="issues">
        <strong>⛔ Cannot commit as-is:</strong>
        <ul>
          {#each issues as i}
            <li>
              <span class="kind-pill {i.kind}">{i.kind}</span>
              {#if i.path}<code>{i.path}</code>{/if}
              {i.message}
            </li>
          {/each}
        </ul>
      </div>
    {/if}

    <details>
      <summary>JSON</summary>
      <pre>{JSON.stringify(plugin, null, 2)}</pre>
    </details>
  {:else}
    <p class="empty">No payload returned for this candidate.</p>
    {#if hasIssues}
      <ul class="issues">
        {#each issues as i}
          <li>
            <span class="kind-pill {i.kind}">{i.kind}</span>
            {i.message}
          </li>
        {/each}
      </ul>
    {/if}
  {/if}

  <footer>
    {#if onSkip}
      <button class="secondary" onclick={onSkip}>Skip</button>
    {/if}
    {#if plugin}
      <button
        class="primary"
        disabled={hasIssues}
        onclick={() => onUse(plugin)}
        title={hasIssues ? 'Fix the issues above before commit' : 'Open the authoring form pre-filled with this candidate'}
      >
        {candidate.source === 'local' ? 'Open' : 'Review & save'} →
      </button>
    {/if}
  </footer>
</article>

<style>
  .card {
    background: white;
    border-radius: 8px;
    padding: 1rem 1.25rem;
    margin: 0.5rem 0;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.08);
    border-left: 4px solid #1f5e3a;
  }
  .card.invalid {
    border-left-color: #b00020;
  }
  header {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    flex-wrap: wrap;
    margin-bottom: 0.25rem;
  }
  .source {
    font-size: 0.75rem;
    color: #555;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }
  .confidence {
    font-size: 0.7rem;
    padding: 0.1rem 0.4rem;
    border-radius: 3px;
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }
  .confidence-high { background: #d8f0d8; color: #1f5e3a; }
  .confidence-medium { background: #fff4d8; color: #8a5a00; }
  .confidence-low { background: #fce8e8; color: #b00020; }
  .score {
    background: #eee;
    color: #555;
    padding: 0.1rem 0.4rem;
    border-radius: 3px;
    font-size: 0.75rem;
    font-weight: 700;
  }
  h3 {
    margin: 0;
    font-size: 1.05rem;
    display: flex;
    align-items: baseline;
    gap: 0.5rem;
  }
  .kind {
    background: #1f5e3a;
    color: white;
    padding: 0.1rem 0.4rem;
    border-radius: 3px;
    font-size: 0.7rem;
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }
  .id {
    background: #eee;
    padding: 0.05rem 0.4rem;
    border-radius: 3px;
    font-size: 0.8rem;
    color: #444;
    margin-right: 0.5rem;
  }
  .version {
    color: #888;
    font-size: 0.85rem;
  }
  .guessed {
    margin: 0.5rem 0;
    font-size: 0.85rem;
    color: #555;
    background: #fff8e7;
    border-left: 3px solid #d4a017;
    padding: 0.4rem 0.6rem;
    border-radius: 3px;
  }
  .guessed code {
    background: rgba(0, 0, 0, 0.05);
    padding: 0 0.2rem;
    border-radius: 2px;
  }
  details {
    margin-top: 0.5rem;
  }
  summary {
    cursor: pointer;
    color: #1f5e3a;
    font-size: 0.85rem;
  }
  pre {
    background: #fafafa;
    padding: 0.5rem;
    border-radius: 4px;
    font-size: 0.8rem;
    overflow-x: auto;
    border: 1px solid #d0d7d0;
  }
  .citations {
    margin: 0.25rem 0;
    padding-left: 1.2rem;
    font-size: 0.85rem;
  }
  .issues {
    background: #fce8e8;
    border-left: 3px solid #b00020;
    padding: 0.5rem 0.75rem;
    margin: 0.5rem 0;
    border-radius: 3px;
    font-size: 0.85rem;
  }
  .issues ul {
    margin: 0.25rem 0 0;
    padding-left: 1.2rem;
  }
  .kind-pill {
    display: inline-block;
    padding: 0 0.3rem;
    border-radius: 2px;
    font-size: 0.7rem;
    font-weight: 700;
    text-transform: uppercase;
    margin-right: 0.3rem;
  }
  .kind-pill.schema { background: #fff4d8; color: #8a5a00; }
  .kind-pill.bypass { background: #fce8e8; color: #b00020; }
  .empty {
    color: #888;
    font-style: italic;
    margin: 0.5rem 0;
  }
  footer {
    display: flex;
    gap: 0.5rem;
    justify-content: flex-end;
    margin-top: 0.75rem;
  }
  button {
    border: 0;
    padding: 0.4rem 0.85rem;
    border-radius: 4px;
    font-weight: 600;
    cursor: pointer;
    min-height: 36px;
  }
  button.primary {
    background: #1f5e3a;
    color: white;
  }
  button.primary:disabled {
    background: #aaa;
    cursor: not-allowed;
  }
  button.secondary {
    background: white;
    border: 1px solid #d0d7d0;
    color: #444;
  }
</style>

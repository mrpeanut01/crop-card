<script lang="ts">
  import { invalidateAll } from '$app/navigation';

  let { data } = $props();

  let typeFilter = $state<'all' | 'crop' | 'herbicide' | 'insecticide' | 'companion'>('all');
  let viewing = $state<string | null>(null);

  const filtered = $derived(
    typeFilter === 'all' ? data.records : data.records.filter((r) => r.type === typeFilter)
  );

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
  <a class="primary-cta" href="/plugins/new">+ Author a new plugin (guided wizard)</a>
{:else}
  <p class="role-notice">
    📚 <strong>View only</strong> — helper role can browse + audit plugins. Sign in as Owner to author
    or upload new ones.
  </p>
{/if}

{#if data.failures.length > 0}
  <section class="alert">
    <strong>⚠ {data.failures.length} plugin file(s) failed to load:</strong>
    <ul>
      {#each data.failures as f}<li>{f}</li>{/each}
    </ul>
  </section>
{/if}

<section class="card">
  <h2>Filter</h2>
  <div class="filters">
    {#each ['all', 'crop', 'herbicide', 'insecticide', 'companion'] as t (t)}
      <button
        class="filter"
        class:active={typeFilter === t}
        onclick={() => (typeFilter = t as typeof typeFilter)}
      >
        {t}
      </button>
    {/each}
  </div>
</section>

<section class="card">
  <h2>Registered plugins</h2>
  <ul class="plugins">
    {#each filtered as r (r.pluginId)}
      <li>
        <header>
          <strong>{r.displayName}</strong>
          <code class="id">{r.pluginId}</code>
          <span class="type-badge type-{r.type}">{r.type}</span>
          <span class="version">v{r.version}</span>
        </header>
        <div class="meta">
          <code title="SHA-256 of canonical plugin JSON">{r.hash.slice(0, 16)}…</code>
        </div>
        <button class="link" onclick={() => (viewing = viewing === r.pluginId ? null : r.pluginId)}>
          {viewing === r.pluginId ? 'Hide JSON' : 'View JSON'}
        </button>
        {#if viewing === r.pluginId}
          <pre>{JSON.stringify(r.plugin, null, 2)}</pre>
        {/if}
      </li>
    {/each}
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
  .filters {
    display: flex;
    gap: 0.5rem;
    flex-wrap: wrap;
  }
  .filter {
    background: white;
    border: 2px solid #d0d7d0;
    padding: 0.4rem 0.75rem;
    border-radius: 4px;
    font: inherit;
    cursor: pointer;
    text-transform: capitalize;
    min-height: 40px;
  }
  .filter.active {
    background: #1f5e3a;
    color: white;
    border-color: #1f5e3a;
  }
  .plugins {
    list-style: none;
    padding: 0;
    margin: 0;
  }
  .plugins li {
    padding: 0.6rem 0;
    border-top: 1px solid #eee;
  }
  .plugins li:first-child {
    border-top: none;
  }
  .plugins header {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    flex-wrap: wrap;
  }
  .id {
    font-family: monospace;
    color: #555;
    background: #f5f5f5;
    padding: 0.05rem 0.4rem;
    border-radius: 3px;
    font-size: 0.8rem;
  }
  .type-badge {
    padding: 0.1rem 0.5rem;
    border-radius: 3px;
    font-size: 0.75rem;
    font-weight: 600;
    text-transform: uppercase;
    color: white;
  }
  .type-crop {
    background: #1f5e3a;
  }
  .type-herbicide {
    background: #b00020;
  }
  .type-insecticide {
    background: #b35900;
  }
  .type-companion {
    background: #6b3fa0;
  }
  .version {
    color: #888;
    font-size: 0.85rem;
    margin-left: auto;
  }
  .meta {
    color: #555;
    font-size: 0.8rem;
    margin: 0.25rem 0;
  }
  .link {
    background: none;
    border: none;
    color: #1f5e3a;
    cursor: pointer;
    text-decoration: underline;
    padding: 0;
    font: inherit;
    margin-top: 0.25rem;
  }
  pre {
    background: #f5f5f5;
    padding: 0.75rem;
    border-radius: 4px;
    margin-top: 0.5rem;
    font-size: 0.8rem;
    overflow-x: auto;
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

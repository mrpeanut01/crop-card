<script lang="ts">
  import { invalidateAll } from '$app/navigation';
  import ForageTestForm from '$lib/components/forage/ForageTestForm.svelte';
  import Provenance from '$lib/components/ui/Provenance.svelte';

  const { data } = $props();
  let banner = $state<string | null>(null);
  let error = $state<string | null>(null);
  let deleting = $state<string | null>(null);

  async function remove(id: string) {
    deleting = id;
    error = null;
    try {
      const res = await fetch(`/api/forage/tests/${encodeURIComponent(id)}`, { method: 'DELETE' });
      const out = await res.json().catch(() => ({}));
      if (!res.ok) {
        error = out.message ?? `Could not delete (HTTP ${res.status}).`;
        return;
      }
      banner = 'Forage test deleted.';
      await invalidateAll();
    } finally {
      deleting = null;
    }
  }
</script>

<svelte:head><title>Forage tests · {data.title}</title></svelte:head>

<main class="forage-page">
  <a class="back" href={data.backHref}>Back</a>
  <h1>Forage tests</h1>
  <p class="lede">{data.title}</p>

  {#if banner}<p class="banner" role="status">{banner}</p>{/if}
  {#if error}<p class="error" role="alert">{error}</p>{/if}

  {#if data.access.canRecord}
    {#if !data.target && data.blocks.length === 0}
      <p class="muted">This Area has no blocks yet, so there is nowhere to file a test.</p>
    {:else}
      <section class="card">
        <h2>Record a forage test</h2>
        <ForageTestForm
          target={data.target}
          blocks={data.blocks}
          canAttach={data.access.canAttach}
          onSaved={async () => {
            banner = 'Forage test saved.';
            await invalidateAll();
          }}
        />
      </section>
    {/if}
  {/if}

  <section class="card">
    <h2>On file</h2>
    {#if data.tests.length === 0}
      <p class="muted">No forage tests on file here yet.</p>
    {:else}
      <ul class="tests">
        {#each data.tests as t (t.id)}
          <li data-testid="forage-test-row">
            {#if t.where}<p class="where">{t.where}{t.lab ? ` · ${t.lab}` : ''}</p>{/if}
            {#if t.ratingText}
              <p class="rating">{t.ratingText} <Provenance source="manual" compact /></p>
            {/if}
            {#if t.valueText}<p>{t.valueText}</p>{/if}
            {#if t.convertedText}<p class="muted">{t.convertedText}</p>{/if}
            {#if t.hasReport}<p class="muted">Lab report attached.</p>{/if}
            {#if data.access.canDelete}
              <button
                class="secondary"
                type="button"
                disabled={deleting === t.id}
                onclick={() => remove(t.id)}
              >
                {deleting === t.id ? 'Deleting…' : 'Delete'}
              </button>
            {/if}
          </li>
        {/each}
      </ul>
    {/if}
  </section>
</main>

<style>
  .forage-page {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    max-width: 720px;
    margin: 0 auto;
    padding: var(--space-3);
    min-width: 0;
  }
  .back {
    display: inline-flex;
    align-items: center;
    align-self: flex-start;
    min-height: 48px;
    color: var(--color-forest);
    font-weight: 600;
  }
  h1 {
    margin: 0;
  }
  h2 {
    margin: 0 0 var(--space-2);
    font-size: var(--font-size-h3, 1.1rem);
  }
  .lede {
    margin: 0;
    color: var(--color-ink-soft);
    overflow-wrap: anywhere;
  }
  .card {
    border: 1px solid var(--color-divider);
    border-radius: var(--radius-card);
    background: var(--color-paper);
    padding: var(--space-3);
    min-width: 0;
  }
  .tests {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }
  .tests li {
    border-top: 1px solid var(--color-divider);
    padding-top: var(--space-2);
    overflow-wrap: anywhere;
  }
  .tests li:first-child {
    border-top: none;
    padding-top: 0;
  }
  p {
    margin: var(--space-1) 0;
  }
  .where {
    font-weight: 600;
  }
  .rating {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-1);
    font-weight: 600;
  }
  .muted {
    font-size: var(--font-size-caption);
    color: var(--color-ink-soft);
  }
  .banner {
    margin: 0;
    color: var(--color-forest);
  }
  .error {
    margin: 0;
    color: var(--color-rust);
  }
  .secondary {
    min-height: 48px;
    padding: 0 var(--space-4);
    border: 1px solid var(--color-divider);
    border-radius: var(--radius-input);
    background: var(--color-paper);
    color: var(--color-ink);
    font: inherit;
    font-weight: 600;
    cursor: pointer;
  }
</style>

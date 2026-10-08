<script lang="ts">
  import { invalidateAll } from '$app/navigation';
  import ForageTestForm from '$lib/components/forage/ForageTestForm.svelte';
  import Provenance from '$lib/components/ui/Provenance.svelte';
  import { createT } from '$lib/i18n';

  const { data } = $props();
  const tr = $derived(createT(data.locale));
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
        error = out.message ?? tr('forage.page.errDelete', { status: res.status });
        return;
      }
      banner = tr('forage.page.deleted');
      await invalidateAll();
    } finally {
      deleting = null;
    }
  }
</script>

<svelte:head><title>{tr('forage.page.titleTag', { title: data.title })}</title></svelte:head>

<div class="forage-page">
  <a class="back" href={data.backHref}>{tr('forage.page.back')}</a>
  <h1>{tr('forage.page.h1')}</h1>
  {#if !data.picker}<p class="lede">{data.title}</p>{/if}

  {#if data.picker}
    <section class="card" data-testid="forage-picker">
      <h2>{tr('forage.page.pickTitle')}</h2>
      {#if data.picker.length === 0}
        <p class="muted">{tr('forage.page.pickNone')}</p>
        <a class="pick" href="/plan">{tr('forage.page.pickPlan')}</a>
      {:else}
        <p class="muted">{tr('forage.page.pickLede')}</p>
        <ul class="picks">
          {#each data.picker as a (a.id)}
            <li>
              <a class="pick" href={`/forage?fieldId=${encodeURIComponent(a.id)}`}>{a.name}</a>
            </li>
          {/each}
        </ul>
      {/if}
    </section>
  {:else}
    {#if banner}<p class="banner" role="status">{banner}</p>{/if}
    {#if error}<p class="error" role="alert">{error}</p>{/if}

    {#if data.access.canRecord}
      {#if !data.target && data.blocks.length === 0}
        <p class="muted">{tr('forage.page.noBlocks')}</p>
      {:else}
        <section class="card">
          <h2>{tr('forage.record')}</h2>
          <ForageTestForm
            target={data.target}
            blocks={data.blocks}
            canAttach={data.access.canAttach}
            onSaved={async () => {
              banner = tr('forage.saved');
              await invalidateAll();
            }}
          />
        </section>
      {/if}
    {/if}

    <section class="card">
      <h2>{tr('forage.page.onFile')}</h2>
      {#if data.tests.length === 0}
        <p class="muted">{tr('forage.page.none')}</p>
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
              {#if t.hasReport}<p class="muted">{tr('forage.page.reportAttached')}</p>{/if}
              {#if data.access.canDelete}
                <button
                  class="secondary"
                  type="button"
                  disabled={deleting === t.id}
                  onclick={() => remove(t.id)}
                >
                  {deleting === t.id ? tr('forage.page.deleting') : tr('forage.page.delete')}
                </button>
              {/if}
            </li>
          {/each}
        </ul>
      {/if}
    </section>
  {/if}
</div>

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
  .picks {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  .pick {
    display: flex;
    align-items: center;
    min-height: var(--btn-height-min-tap);
    color: var(--color-forest-deep);
    font-weight: 600;
    overflow-wrap: anywhere;
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

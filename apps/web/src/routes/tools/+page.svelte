<script lang="ts">
  import type { PageData } from './$types';
  import { createT } from '$lib/i18n';
  let { data }: { data: PageData } = $props();
  const tr = $derived(createT(data.locale));
</script>

<svelte:head><title>{tr('tools.title')} — CropCard</title></svelte:head>

<header class="head">
  <h1>{tr('tools.title')}</h1>
  <p class="subtitle">{tr('tools.subtitle')}</p>
</header>

<section class="tools-grid">
  {#if data.showPlanterPlate}
    <a class="tool-card" href="/tools/planter-plate-selector">
      <h2>{tr('tools.plate.card.title')}</h2>
      <p>
        {tr('tools.plate.card.body')}
      </p>
    </a>
  {/if}
  <a class="tool-card" href="/calibrate">
    <h2>{tr('tools.calib.title')}</h2>
    <p>
      {tr('tools.calib.body')}
    </p>
  </a>
</section>

<style>
  .head h1 {
    margin: 0 0 0.25rem;
  }
  .subtitle {
    color: var(--color-ink-muted);
    margin: 0 0 1rem;
  }
  .tools-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
    gap: 0.75rem;
  }
  .tool-card {
    display: block;
    background: var(--color-paper);
    border-radius: var(--radius-card, 8px);
    padding: 1rem 1.25rem;
    text-decoration: none;
    color: inherit;
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.05);
    border-left: 4px solid var(--color-forest-deep);
  }
  .tool-card:hover {
    box-shadow: 0 2px 6px rgba(0, 0, 0, 0.08);
  }
  .tool-card h2 {
    margin: 0 0 0.4rem;
    color: var(--color-forest-deep);
    font-size: 1.1rem;
  }
  .tool-card p {
    margin: 0;
    color: var(--color-ink-muted);
    font-size: 0.9rem;
  }
</style>

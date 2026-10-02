<script lang="ts">
  import type { PriorSeason } from './types';
  import { createT } from '$lib/i18n';
  import { page } from '$app/state';

  const { priorSeason }: { priorSeason: PriorSeason } = $props();
  const tr = $derived(createT(page.data?.locale));
</script>

<section class="aw-prior" aria-labelledby="aw-prior-title" data-testid="prior-season-panel">
  <h3 id="aw-prior-title">{tr('wizard.prior.title', { year: priorSeason.year })}</h3>
  <p class="aw-prior-lede">
    {tr('wizard.prior.lede')}
  </p>
  <ul>
    {#each priorSeason.blocks as b (b.blockId)}
      <li>
        <span class="aw-prior-block">{b.blockName}</span>
        <span class="aw-prior-crops">{b.crops.join(', ')}</span>
      </li>
    {/each}
  </ul>
  <a class="aw-prior-link" href="/settings/season/carry-forward" target="_blank" rel="noopener">
    {tr('wizard.prior.link')}
  </a>
</section>

<style>
  .aw-prior {
    margin: 0 0 1rem;
    padding: 0.85rem 1rem;
    border: 1px solid var(--color-divider, #cbd5cb);
    border-radius: 8px;
    background: var(--color-paper, #fbfaf5);
  }
  h3 {
    margin: 0 0 0.25rem;
    font-size: 1rem;
    color: #1f3a26;
  }
  .aw-prior-lede {
    margin: 0 0 0.6rem;
    color: #4a5d4a;
    font-size: 0.9rem;
  }
  ul {
    list-style: none;
    margin: 0 0 0.6rem;
    padding: 0;
    display: grid;
    gap: 0.3rem;
  }
  li {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
    font-size: 0.9rem;
  }
  .aw-prior-block {
    font-weight: 700;
    color: #1f3a26;
    min-width: 8rem;
  }
  .aw-prior-crops {
    color: #4a5d4a;
  }
  .aw-prior-link {
    font-size: 0.85rem;
    color: var(--color-forest, #2f5d3a);
    font-weight: 600;
  }
</style>

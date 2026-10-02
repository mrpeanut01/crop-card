<script lang="ts">
  import Kicker from '$lib/components/ui/Kicker.svelte';
  import { createT } from '$lib/i18n';
  import { page } from '$app/state';

  const tr = $derived(createT(page.data?.locale));
</script>

<svelte:head><title>{tr('plugins.community.title')}</title></svelte:head>

<header class="head">
  <Kicker>{tr('plugins.community.kicker')}</Kicker>
  <h1>{tr('plugins.community.h1')}</h1>
  <p class="lede">
    {tr('plugins.community.lede')}
  </p>
</header>

<section class="card" aria-labelledby="add-now">
  <h2 id="add-now">{tr('plugins.community.addNow')}</h2>
  <ul class="actions">
    <li>
      <a class="action primary" href="/plugins" data-testid="community-upload">
        {tr('plugins.community.upload')}
      </a>
      <span class="hint">
        {tr('plugins.community.uploadHint')}
      </span>
    </li>
    <li>
      <a class="action" href="/plugins/new">{tr('plugins.community.author')}</a>
      <span class="hint">{tr('plugins.community.authorHint')}</span>
    </li>
    <li>
      <a class="action" href="/inventory?type=crop&mode=catalog" data-testid="community-catalog">
        {tr('plugins.community.browse')}
      </a>
      <span class="hint">{tr('plugins.community.browseHint')}</span>
    </li>
  </ul>
</section>

<section class="card" aria-labelledby="status">
  <h2 id="status">{tr('plugins.community.statusH2')}</h2>
  <p>
    {tr('plugins.community.status1')}
  </p>
  <p>
    {tr('plugins.community.status2')}
  </p>
</section>

<style>
  .head {
    margin-bottom: 1rem;
  }
  h1 {
    margin: 0.25rem 0 0.5rem;
  }
  .lede {
    margin: 0;
    color: var(--color-ink-soft, #444);
    max-width: 60ch;
  }
  .card {
    background: var(--color-paper, white);
    border: 1px solid var(--color-divider, #e5e0d5);
    padding: 1.25rem;
    border-radius: 8px;
    margin-bottom: 1rem;
  }
  h2 {
    margin: 0 0 0.75rem;
    font-size: 1.1rem;
  }
  .actions {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: 0.9rem;
  }
  .actions li {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }
  .action {
    display: inline-flex;
    align-items: center;
    align-self: flex-start;
    min-height: 48px;
    padding: 0 1rem;
    border-radius: 6px;
    border: 1px solid var(--color-forest, #2f5a3a);
    color: var(--color-forest, #2f5a3a);
    font-weight: 600;
    text-decoration: none;
  }
  .action.primary {
    background: var(--color-forest, #2f5a3a);
    color: var(--color-cream, #fff);
  }
  .action:focus-visible {
    outline: 3px solid var(--color-sky, #6f8fa8);
    outline-offset: 2px;
  }
  .hint {
    font-size: 0.9rem;
    color: var(--color-ink-muted, #555);
  }
</style>

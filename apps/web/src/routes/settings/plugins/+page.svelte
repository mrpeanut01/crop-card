<script lang="ts">
  import { Box, Upload, Search } from 'lucide-svelte';
  import Kicker from '$lib/components/ui/Kicker.svelte';

  let { data } = $props();
</script>

<svelte:head>
  <title>Plugins & crop library · CropCard</title>
</svelte:head>

<a class="back-link" href="/settings">← All settings</a>
<header class="page-head">
  <Kicker>Plugin library · data-only</Kicker>
  <h1>Plugins & crop library</h1>
  <p class="lede">
    {data.total} plugin{data.total === 1 ? '' : 's'} loaded · all data-only, schema-validated at
    registration. Browse, upload, or diff at the dedicated routes below.
  </p>
</header>

<section class="card">
  <h2>By type</h2>
  <ul class="type-grid">
    {#each data.byType as t (t.type)}
      <li class="type-card">
        <span class="type-name">{t.type}</span>
        <span class="type-count">{t.count}</span>
      </li>
    {/each}
  </ul>
</section>

<section class="card">
  <h2>Actions</h2>
  <ul class="action-list">
    <li>
      <a class="action" href="/plugins">
        <Box size={16} strokeWidth={1.75} />
        Browse all plugins
        <span class="sub">{data.total} loaded</span>
      </a>
    </li>
    <li>
      <a class="action" href="/plugins/new">
        <Upload size={16} strokeWidth={1.75} />
        Upload a new plugin
        <span class="sub">JSON file or paste</span>
      </a>
    </li>
    <li>
      <a class="action" href="/plugins/community">
        <Search size={16} strokeWidth={1.75} />
        Community marketplace
        <span class="sub">Search shared plugins</span>
      </a>
    </li>
  </ul>
</section>

<style>
  .back-link {
    display: inline-block;
    margin-bottom: 12px;
    font-size: 13px;
    color: var(--color-forest-deep);
    text-decoration: none;
  }
  .back-link:hover {
    text-decoration: underline;
  }
  .page-head h1 {
    margin: 4px 0 8px;
    font-family: var(--font-serif, serif);
    font-size: 26px;
    color: var(--color-forest-deep);
  }
  .lede {
    margin: 0 0 18px;
    font-size: 13.5px;
    color: var(--color-ink-soft);
    line-height: 1.45;
    max-width: 60ch;
  }
  .card {
    background: var(--color-paper);
    border: 1px solid var(--color-divider);
    border-radius: var(--radius-card, 8px);
    padding: 18px;
    margin-bottom: 16px;
  }
  .card h2 {
    margin: 0 0 12px;
    font-size: 16px;
    color: var(--color-ink);
  }
  .type-grid {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
    gap: 8px;
  }
  .type-card {
    background: var(--color-cream);
    border: 1px solid var(--color-divider-soft);
    border-radius: var(--radius-input, 6px);
    padding: 10px 12px;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .type-name {
    font-size: 11.5px;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--color-ink-muted);
    font-weight: 700;
  }
  .type-count {
    font-size: 22px;
    font-weight: 700;
    color: var(--color-forest-deep);
    font-family: var(--font-serif, serif);
  }
  .action-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .action {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 12px 14px;
    background: var(--color-cream);
    border: 1px solid var(--color-divider-soft);
    border-radius: var(--radius-input, 6px);
    text-decoration: none;
    color: var(--color-ink);
    font-size: 13.5px;
    font-weight: 600;
  }
  .action:hover {
    border-color: var(--color-forest-deep);
  }
  .sub {
    margin-left: auto;
    color: var(--color-ink-muted);
    font-size: 12px;
    font-weight: 400;
  }
</style>

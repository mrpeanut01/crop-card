<script lang="ts">
  import { page } from '$app/state';
  import { createT } from '$lib/i18n';
  import {
    BIOASSAY_NOTES,
    BIOASSAY_RATIOS,
    BIOASSAY_SOURCE_LINKS,
    BIOASSAY_STEPS,
    BIOASSAY_TIMING
  } from '$lib/amendments/bioassayGuide';

  const tr = $derived(createT(page.data?.locale));
</script>

<details class="guide" data-testid="bioassay-guide">
  <summary>{tr('bioassay.guide.summary')}</summary>
  <ol>
    {#each BIOASSAY_STEPS as s (s.id)}<li>{s.text}</li>{/each}
  </ol>
  <p class="sub">{tr('bioassay.guide.mixLead')}</p>
  <ul>
    {#each BIOASSAY_RATIOS as s (s.id)}<li>{s.text}</li>{/each}
  </ul>
  <p class="sub">{tr('bioassay.guide.howLong')}</p>
  <ul>
    {#each BIOASSAY_TIMING as s (s.id)}<li>{s.text}</li>{/each}
  </ul>
  <ul>
    {#each BIOASSAY_NOTES as s (s.id)}<li>{s.text}</li>{/each}
  </ul>
  <p class="sub">
    {tr('bioassay.guide.notResult')}
    {#each BIOASSAY_SOURCE_LINKS as l (l.href)}
      <a href={l.href} target="_blank" rel="noopener noreferrer nofollow">{l.label}</a>
    {/each}
  </p>
</details>

<style>
  .guide {
    border: 1px solid var(--color-divider);
    border-radius: var(--radius-card);
    padding: var(--space-2) var(--space-3);
    background: var(--color-paper);
    min-width: 0;
    overflow-wrap: anywhere;
  }
  summary {
    cursor: pointer;
    min-height: 48px;
    display: flex;
    align-items: center;
    font-weight: 600;
  }
  .sub {
    margin: var(--space-2) 0 0;
    font-size: var(--font-size-caption);
    color: var(--color-ink-soft);
  }
  a {
    display: inline-flex;
    align-items: center;
    min-height: 48px;
  }
  ol,
  ul {
    margin: var(--space-1) 0 0;
    padding-left: 1.2em;
  }
</style>

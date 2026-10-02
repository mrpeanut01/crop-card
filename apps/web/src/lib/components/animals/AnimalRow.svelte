<script lang="ts">
  import Pill from '$lib/components/ui/Pill.svelte';
  import SpeciesIcon from './SpeciesIcon.svelte';
  import { createT } from '$lib/i18n';
  import { page } from '$app/state';

  interface Props {
    href: string;
    icon: string | null | undefined;
    title: string;
    /** Short facts under the title, e.g. "24 chickens", "Hen house". */
    meta?: (string | null | undefined)[];
    foodProducing: boolean;
    /** A pill such as "Sold" for an animal that is no longer here. */
    status?: string | null;
  }

  const { href, icon, title, meta = [], foodProducing, status = null }: Props = $props();
  const facts = $derived(meta.filter((m): m is string => !!m));
  const tr = $derived(createT(page.data?.locale));
</script>

<a class="row" {href}>
  <span class="icon"><SpeciesIcon {icon} size={22} /></span>
  <span class="body">
    <span class="title">{title}</span>
    {#if facts.length > 0}
      <span class="meta">{facts.join(' · ')}</span>
    {/if}
  </span>
  <span class="chips">
    {#if status}<Pill tone="neutral">{status}</Pill>{/if}
    {#if foodProducing}<Pill tone="wheat">{tr('animals.foodAnimal')}</Pill>{/if}
  </span>
</a>

<style>
  .row {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    min-height: 56px;
    padding: var(--space-2) var(--space-3);
    border: 1px solid var(--color-divider);
    border-radius: var(--radius-card);
    background: var(--color-paper);
    color: var(--color-ink);
    text-decoration: none;
    min-width: 0;
  }
  .row:hover {
    background: var(--color-divider-soft);
  }
  .icon {
    flex: none;
    width: 40px;
    height: 40px;
    display: grid;
    place-items: center;
    border-radius: var(--radius-pill);
    background: var(--pill-forest-bg);
    color: var(--color-forest-deep);
  }
  .body {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
    flex: 1;
  }
  .title {
    font-weight: 600;
    overflow-wrap: anywhere;
  }
  .meta {
    font-size: var(--font-size-caption);
    color: var(--color-ink-soft);
    overflow-wrap: anywhere;
  }
  .chips {
    display: flex;
    flex-wrap: wrap;
    justify-content: flex-end;
    gap: 4px;
    flex: none;
    max-width: 45%;
  }
</style>

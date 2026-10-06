<script lang="ts">
  import { page } from '$app/state';
  import Provenance from '$lib/components/ui/Provenance.svelte';
  import { createT, type MessageKey } from '$lib/i18n';

  /** Season Setup shows the owner's per-Area orchard guide choices again
   *  every season (OP-4). Owner only; shows nothing without a choice. */
  const tr = $derived(createT(page.data?.locale));
  let areas = $state<{ areaId: string; areaName: string; audience: 'home' | 'commercial' }[]>([]);

  $effect(() => {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
    let live = true;
    void (async () => {
      try {
        const res = await fetch('/api/orchard/audiences');
        if (!res.ok || !live) return;
        const body = (await res.json()) as { areas?: typeof areas };
        if (live) areas = body.areas ?? [];
      } catch {
        areas = [];
      }
    })();
    return () => {
      live = false;
    };
  });
</script>

{#if areas.length}
  <section class="guides" data-testid="orchard-guide-choices">
    <h3>{tr('orchardui.setup.heading')}</h3>
    <p>{tr('orchardui.setup.lede')}</p>
    <ul>
      {#each areas as a (a.areaId)}
        <li>
          <Provenance source="manual" compact />
          {tr('orchardui.setup.row', {
            area: a.areaName,
            guide: tr(`orchardui.audience.${a.audience}` as MessageKey)
          })}
          <a href="/plan?area={encodeURIComponent(a.areaId)}">{tr('orchardui.setup.change')}</a>
        </li>
      {/each}
    </ul>
  </section>
{/if}

<style>
  .guides {
    margin: var(--space-3) 0;
    padding: var(--space-3);
    border: 1px solid var(--color-rule);
    border-radius: var(--radius-card, 12px);
  }
  h3 {
    margin: 0 0 var(--space-1);
    font-size: 1rem;
  }
  p {
    margin: 0 0 var(--space-2);
    color: var(--color-ink-soft);
  }
  ul {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  li {
    display: flex;
    gap: var(--space-2);
    align-items: center;
    flex-wrap: wrap;
  }
  a {
    display: inline-flex;
    align-items: center;
    min-height: 48px;
    color: var(--color-forest);
    font-weight: 600;
  }
</style>

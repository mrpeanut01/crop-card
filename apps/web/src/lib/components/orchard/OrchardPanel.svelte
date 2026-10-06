<script lang="ts">
  import { page } from '$app/state';
  import Provenance from '$lib/components/ui/Provenance.svelte';
  import { createT, type MessageKey } from '$lib/i18n';
  import { cropDisplayNameByEnglish } from '$lib/i18n/cropName';
  import { orchardStageName } from '$lib/i18n/orchardCalendarText';
  import type { OrchardSummary } from '$lib/orchard/summary';

  /** The short orchard calendar panel on the Planting Card page and the
   *  Area Card (#562, OC-7): guide, marked stage and a link to the full
   *  calendar. No windows here, so no bee or label line. Online only; it
   *  never shows saved data. */
  interface Props {
    cropId?: string;
    areaId?: string;
  }
  const { cropId, areaId }: Props = $props();
  const tr = $derived(createT(page.data?.locale));
  const locale = $derived(page.data?.locale ?? null);

  let rows = $state<OrchardSummary[]>([]);
  let offline = $state(false);

  $effect(() => {
    rows = [];
    offline = false;
    const url = cropId
      ? `/api/orchard/plantings/${encodeURIComponent(cropId)}`
      : areaId
        ? `/api/orchard/areas/${encodeURIComponent(areaId)}`
        : null;
    if (!url) return;
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      offline = !!cropId;
      return;
    }
    let live = true;
    void (async () => {
      try {
        const res = await fetch(url);
        if (!res.ok || !live) return;
        const body = (await res.json()) as OrchardSummary | { plantings: OrchardSummary[] };
        const list = 'plantings' in body ? body.plantings : [body];
        if (live) rows = list.filter((r) => r.status !== 'none-wanted');
      } catch {
        if (live) offline = !!cropId;
      }
    })();
    return () => {
      live = false;
    };
  });

  function stageText(r: OrchardSummary): string {
    if (!r.calendar || !r.stage) return '';
    return orchardStageName(r.calendar.pluginId, r.stage, locale);
  }
</script>

{#if offline && cropId}
  <section class="orchard-panel" data-testid="orchard-panel">
    <h3>{tr('orchardui.areaHeading')}</h3>
    <p>{tr('orchardui.offline')}</p>
    <a href="/plan/orchard/{encodeURIComponent(cropId)}">{tr('orchardui.open')}</a>
  </section>
{:else if rows.length}
  <section class="orchard-panel" data-testid="orchard-panel">
    <h3>{tr('orchardui.areaHeading')}</h3>
    <ul>
      {#each rows as r (r.cropId)}
        {@const crop = cropDisplayNameByEnglish(r.cropName, locale)}
        <li data-crop-id={r.cropId}>
          {#if r.status === 'out-of-date'}
            <p>{crop}: {tr('orchardui.outOfDate')}</p>
          {:else if r.status === 'none'}
            <p>{crop}: {tr('orchardui.none')}</p>
          {:else}
            <p>
              {#if r.mark && r.stage}
                <Provenance source="manual" compact />
                {tr('orchardui.panelMarked', { crop, stage: stageText(r) })}
              {:else}
                {tr('orchardui.panelUnmarked', { crop })}
              {/if}
            </p>
            {#if r.calendar}
              <p class="guide">
                {tr(`orchardui.audience.${r.audience.audience}` as MessageKey)} · {r.calendar
                  .publicationId} ({r.calendar.edition})
              </p>
            {/if}
            <a href={r.href}>{tr('orchardui.open')}</a>
          {/if}
        </li>
      {/each}
    </ul>
  </section>
{/if}

<style>
  .orchard-panel {
    margin: var(--space-3) 0;
    padding: var(--space-3);
    border: 1px solid var(--color-rule);
    border-radius: var(--radius-card, 12px);
  }
  h3 {
    margin: 0 0 var(--space-2);
    font-size: 1rem;
  }
  ul {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }
  p {
    margin: 0;
  }
  .guide {
    color: var(--color-ink-soft);
    font-size: var(--font-size-meta);
  }
  a {
    display: inline-flex;
    align-items: center;
    min-height: 48px;
    color: var(--color-forest);
    font-weight: 600;
  }
</style>

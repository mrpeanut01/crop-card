<script lang="ts">
  import { untrack } from 'svelte';
  import { page } from '$app/state';
  import Provenance from '$lib/components/ui/Provenance.svelte';
  import type { FarmSnapshot } from '$lib/cards/snapshot';
  import { createT, type MessageKey } from '$lib/i18n';
  import { cropDisplayNameByEnglish } from '$lib/i18n/cropName';
  import {
    orchardStageName,
    orchardTargetLabel,
    orchardWindowNote
  } from '$lib/i18n/orchardCalendarText';
  import { beeLineFor } from '$lib/orchard/appLines';
  import { offlineOrchardRows, type OfflineOrchard } from '$lib/orchard/offline';
  import type { OrchardSummary } from '$lib/orchard/summary';
  import { fmt } from '$lib/prefsState.svelte';

  /** The short orchard calendar panel on the Planting Card page and the
   *  Area Card (#562, OC-7): guide, marked stage and a link to the full
   *  calendar. Online it reads the server. With no connection it reads the
   *  saved Card snapshot (#593, OS-1 to OS-6): the saved mark with its date
   *  and the copy's time, that stage's windows with the bee line and "Check
   *  the label." (OP-8), and no marking. Nothing here sets a bloom answer. */
  interface Props {
    cropId?: string;
    areaId?: string;
    /** The saved snapshot when the page already has it (the /cards pages);
     *  otherwise it is read from this device when the server can't be. */
    snapshot?: FarmSnapshot | null;
  }
  const { cropId, areaId, snapshot }: Props = $props();
  const tr = $derived(createT(page.data?.locale));
  const locale = $derived(page.data?.locale ?? null);

  let rows = $state<OrchardSummary[]>([]);
  let offline = $state(false);
  let saved = $state<OfflineOrchard | null>(null);

  async function useSaved(live: () => boolean) {
    let snap: FarmSnapshot | null = snapshot ?? null;
    if (!snap) {
      try {
        const { loadSnapshot } = await import('$lib/client/cardStore');
        snap = (await loadSnapshot())?.bundle ?? null;
      } catch {
        snap = null;
      }
    }
    if (!live()) return;
    const next = offlineOrchardRows(snap, { cropId, areaId }, Date.now());
    saved = next;
    offline = !next && !!cropId;
  }

  $effect(() => {
    rows = [];
    offline = false;
    saved = null;
    const url = cropId
      ? `/api/orchard/plantings/${encodeURIComponent(cropId)}`
      : areaId
        ? `/api/orchard/areas/${encodeURIComponent(areaId)}`
        : null;
    if (!url) return;
    let live = true;
    const isLive = () => live;
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      untrack(() => void useSaved(isLive));
    } else {
      void (async () => {
        try {
          const res = await fetch(url);
          if (!res.ok || !live) return;
          const body = (await res.json()) as OrchardSummary | { plantings: OrchardSummary[] };
          const list = 'plantings' in body ? body.plantings : [body];
          if (live) rows = list.filter((r) => r.status !== 'none-wanted');
        } catch {
          if (live) await untrack(() => useSaved(isLive));
        }
      })();
    }
    return () => {
      live = false;
    };
  });

  function stageText(r: OrchardSummary): string {
    if (!r.calendar || !r.stage) return '';
    return orchardStageName(r.calendar.pluginId, r.stage, locale);
  }
</script>

{#if saved}
  <section class="orchard-panel" data-testid="orchard-panel" data-saved="true">
    <h3>{tr('orchardui.areaHeading')}</h3>
    <ul>
      {#each saved.rows as r (r.cropId)}
        {@const crop = cropDisplayNameByEnglish(r.cropName, locale)}
        <li data-crop-id={r.cropId}>
          {#if r.status === 'out-of-date'}
            <p>{crop}: {tr('orchardui.outOfDate')}</p>
          {:else if !r.calendar}
            <p>{crop}: {tr('orchardui.none')}</p>
          {:else}
            {@const cal = r.calendar}
            {#if r.mark}
              {@const stage = orchardStageName(cal.pluginId, r.mark.stage, locale)}
              <p data-testid="orchard-saved-mark">
                <Provenance source="manual" compact />
                {crop}:
                {r.mark.markedByName
                  ? tr('orchardui.marked', {
                      stage,
                      date: fmt.instant(r.mark.markedAt, 'month-day'),
                      name: r.mark.markedByName
                    })
                  : tr('orchardui.markedNoName', {
                      stage,
                      date: fmt.instant(r.mark.markedAt, 'month-day')
                    })}
              </p>
            {:else}
              <p data-testid="orchard-saved-nomark">
                {crop}: {tr('orchardui.saved.noMark', { year: r.year })}
              </p>
            {/if}
            <p class="guide">
              {tr(`orchardui.audience.${r.audience.audience}` as MessageKey)} · {cal.guide
                .publicationId} ({cal.edition})
            </p>
            {#if r.mark}
              <p class="watch-head">
                {tr('orchardui.saved.stageWatch', {
                  stage: orchardStageName(cal.pluginId, r.mark.stage, locale)
                })}
              </p>
              {#if r.mark.stage.windows.length === 0}
                <p class="guide">{tr('orchardui.noWindows')}</p>
              {:else}
                <ul class="windows">
                  {#each r.mark.stage.windows as w (w.id)}
                    <li data-window={w.id} data-purpose={w.purpose}>
                      <strong>{tr(`orchardui.purpose.${w.purpose}` as MessageKey)}</strong>
                      {#if w.targets.length}
                        <p>
                          {tr('orchardui.targets')}:
                          {w.targets.map((x) => orchardTargetLabel(x.id, locale)).join(', ')}
                        </p>
                      {/if}
                      {#if w.note}<p>{orchardWindowNote(cal.pluginId, w, locale)}</p>{/if}
                      {#if w.pollinatorSensitive}
                        <p class="bee" lang="en" data-english-only="safety" data-testid="bee-line">
                          {beeLineFor(cal.guide.publicationId)}
                        </p>
                      {/if}
                      {#if w.labelLine}
                        <p class="label-line" data-testid="label-line">
                          {tr('orchardui.checkLabel')}
                        </p>
                      {/if}
                    </li>
                  {/each}
                </ul>
              {/if}
            {/if}
          {/if}
        </li>
      {/each}
    </ul>
    <p class="guide" data-testid="orchard-saved-asof">
      {tr('orchardui.saved.asOf', { time: fmt.instant(saved.savedAt, 'datetime') })}
      {tr('orchardui.saved.markNeedsConnection')}
    </p>
  </section>
{:else if offline && cropId}
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
  .windows {
    margin-top: var(--space-1);
    padding-left: var(--space-2);
    border-left: 2px solid var(--color-rule);
  }
  .watch-head,
  .bee {
    font-weight: 600;
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

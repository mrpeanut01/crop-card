<script lang="ts">
  import { onMount } from 'svelte';
  import { enhance } from '$app/forms';
  import { Check, ChevronRight } from 'lucide-svelte';
  import {
    gettingStartedItems,
    gettingStartedMode,
    summarizeGettingStarted,
    type GettingStartedFacts
  } from '$lib/onboarding/gettingStarted';

  interface Props {
    facts: GettingStartedFacts;
    dismissed: boolean;
    /** Where the Dismiss form posts; the card lives on /today. */
    dismissAction?: string;
    /** Test seam: resolves whether any Cards are pinned on this device. */
    loadPinned?: () => Promise<boolean>;
  }

  const {
    facts,
    dismissed,
    dismissAction = '/today?/dismissSetup',
    loadPinned = defaultLoadPinned
  }: Props = $props();

  async function defaultLoadPinned(): Promise<boolean> {
    const { listPinned } = await import('$lib/client/cardStore');
    return (await listPinned()).length > 0;
  }

  let pinned = $state<boolean | null>(null);
  let expanded = $state(false);
  let hiddenNow = $state(false);

  onMount(() => {
    loadPinned()
      .then((v) => (pinned = v))
      .catch(() => (pinned = null));
  });

  const items = $derived(
    gettingStartedItems({ ...facts, hasPinnedCards: pinned ?? facts.hasPinnedCards })
  );
  const summary = $derived(summarizeGettingStarted(items));
  const mode = $derived(hiddenNow ? 'hidden' : gettingStartedMode(summary, dismissed));
  const showFull = $derived(mode === 'full' || (mode === 'strip' && expanded));

  const R = 20;
  const C = 2 * Math.PI * R;
  const dash = $derived(summary.total ? (summary.done / summary.total) * C : 0);
</script>

{#snippet dismissForm()}
  <form
    method="POST"
    action={dismissAction}
    use:enhance={() => {
      hiddenNow = true;
      return async ({ result, update }) => {
        if (result.type !== 'success') hiddenNow = false;
        await update({ reset: false, invalidateAll: false });
      };
    }}
  >
    <button type="submit" class="dismiss">Dismiss</button>
  </form>
{/snippet}

{#if mode !== 'hidden'}
  {#if showFull}
    <section class="gs" aria-labelledby="gs-title" data-testid="getting-started">
      <div class="strip" aria-hidden="true"></div>
      <div class="gs-body">
        <header class="gs-head">
          <div>
            <div class="kicker">Getting started · {summary.done} of {summary.total}</div>
            <h2 id="gs-title" class="serif">A few things, when you're ready</h2>
          </div>
          <svg
            class="ring"
            width="52"
            height="52"
            viewBox="0 0 52 52"
            role="img"
            aria-label="{summary.done} of {summary.total} done"
          >
            <circle cx="26" cy="26" r={R} class="ring-bg" />
            <circle
              cx="26"
              cy="26"
              r={R}
              class="ring-fg"
              stroke-dasharray="{dash} {C}"
              transform="rotate(-90 26 26)"
            />
          </svg>
        </header>
        <ol class="items">
          {#each items as item (item.id)}
            <li class:done={item.done} class:optional={item.optional} data-item={item.id}>
              <a href={item.href} class="row">
                <span class="tick" aria-hidden="true">
                  {#if item.done}<Check size={14} strokeWidth={2.5} />{/if}
                </span>
                <span class="text">
                  <span class="title">
                    {item.title}
                    {#if item.done}<span class="sr-only">(done)</span>{/if}
                  </span>
                  <span class="blurb">{item.blurb}</span>
                </span>
                {#if item.optional}<span class="opt">Optional</span>{/if}
                <ChevronRight size={16} aria-hidden="true" />
              </a>
            </li>
          {/each}
        </ol>
        <footer class="gs-foot">
          {#if mode === 'strip'}
            <button type="button" class="dismiss" onclick={() => (expanded = false)}>
              Show less
            </button>
          {/if}
          {@render dismissForm()}
        </footer>
      </div>
    </section>
  {:else}
    <section class="gs-slim" aria-label="Getting started" data-testid="getting-started-strip">
      <span>Setup {summary.done} of {summary.total}</span>
      <button type="button" class="show" onclick={() => (expanded = true)}>Show</button>
      {@render dismissForm()}
    </section>
  {/if}
{/if}

<style>
  .gs {
    display: flex;
    background: var(--color-paper);
    border: 1px solid var(--color-divider);
    border-radius: var(--radius-card);
    overflow: hidden;
    margin-bottom: 16px;
  }
  .strip {
    width: 6px;
    flex-shrink: 0;
    background: var(--color-forest);
  }
  .gs-body {
    flex: 1;
    min-width: 0;
    padding: var(--card-padding-loose);
  }
  .gs-head {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    gap: 12px;
  }
  .kicker {
    font-size: var(--font-size-kicker);
    text-transform: uppercase;
    letter-spacing: 0.08em;
    font-weight: 700;
    color: var(--color-ink-soft);
  }
  h2 {
    margin: 4px 0 0;
    font-size: var(--font-size-screen-title);
    color: var(--color-forest-deep);
    letter-spacing: var(--letter-tight);
  }
  .ring {
    flex-shrink: 0;
  }
  .ring-bg {
    fill: none;
    stroke: var(--color-divider-soft);
    stroke-width: 5;
  }
  .ring-fg {
    fill: none;
    stroke: var(--color-forest);
    stroke-width: 5;
    stroke-linecap: round;
  }
  .items {
    list-style: none;
    margin: 12px 0 0;
    padding: 0;
    border-top: 1px solid var(--color-divider-soft);
  }
  .items li {
    border-bottom: 1px solid var(--color-divider-soft);
  }
  .row {
    display: flex;
    align-items: center;
    gap: 12px;
    min-height: 56px;
    padding: 8px 4px;
    color: inherit;
    text-decoration: none;
  }
  .row:hover {
    background: var(--color-cream);
  }
  .row:focus-visible {
    outline: 2px solid var(--color-forest);
    outline-offset: -2px;
  }
  .tick {
    width: 26px;
    height: 26px;
    border-radius: 999px;
    border: 1.5px solid var(--color-divider);
    display: grid;
    place-items: center;
    flex-shrink: 0;
    background: var(--color-paper);
  }
  .done .tick {
    background: var(--color-forest);
    border-color: var(--color-forest);
    color: var(--color-cream);
  }
  .text {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .title {
    font-weight: 600;
    color: var(--color-ink);
  }
  .done .title {
    color: var(--color-ink-soft);
    text-decoration: line-through;
    text-decoration-color: var(--color-divider);
  }
  .blurb {
    font-size: 13px;
    color: var(--color-ink-soft);
    line-height: 1.4;
  }
  .optional .title {
    color: var(--color-ink-soft);
    font-weight: 500;
  }
  .opt {
    font-size: var(--font-size-meta);
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--pill-neutral-fg);
    background: var(--pill-neutral-bg);
    border: 1px solid var(--pill-neutral-bd);
    border-radius: var(--radius-pill);
    padding: 2px 8px;
    flex-shrink: 0;
  }
  .gs-foot {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    margin-top: 8px;
  }
  .gs-slim {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 4px 8px 4px 14px;
    margin-bottom: 16px;
    background: var(--color-paper);
    border: 1px solid var(--color-divider);
    border-left: 6px solid var(--color-forest);
    border-radius: var(--radius-card);
    font-weight: 600;
    color: var(--color-forest-deep);
  }
  .gs-slim span {
    flex: 1;
  }
  .show,
  .dismiss {
    font: inherit;
    font-weight: 600;
    min-height: 48px;
    padding: 0 14px;
    border-radius: var(--radius-input);
    cursor: pointer;
  }
  .show {
    border: 1px solid var(--color-divider);
    background: var(--color-paper);
    color: var(--color-forest-deep);
  }
  .dismiss {
    border: none;
    background: none;
    color: var(--color-ink-soft);
    text-decoration: underline;
  }
  .show:focus-visible,
  .dismiss:focus-visible {
    outline: 2px solid var(--color-forest);
    outline-offset: 2px;
  }
  .sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip: rect(0 0 0 0);
    white-space: nowrap;
  }
</style>

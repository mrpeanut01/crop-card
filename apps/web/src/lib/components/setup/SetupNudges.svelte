<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import type { SetupAsk, SetupNudge } from '$lib/onboarding/pageSetup';
  import { createT } from '$lib/i18n';
  import { page } from '$app/state';

  interface Props {
    nudges: SetupNudge[];
    /** Scopes dismissals, e.g. `plan:<ownerId>`. */
    scope: string;
    /** Opens the page's own setup sheet for a question it can ask in place. */
    onAsk?: (ask: SetupAsk) => void;
  }

  const { nudges, scope, onAsk }: Props = $props();

  const tr = $derived(createT(page.data?.locale));

  const SAFETY_STOP = '[data-safety-stop], [role="alertdialog"], .stop[role="alert"]';
  const storageKey = $derived(`setup-nudges:${scope}`);

  let dismissed = $state<Set<string>>(new Set());
  let stopOnScreen = $state(false);
  let observer: MutationObserver | null = null;

  function readDismissed(): Set<string> {
    try {
      const raw = sessionStorage.getItem(storageKey);
      return new Set(raw ? (JSON.parse(raw) as string[]) : []);
    } catch {
      return new Set();
    }
  }

  function dismiss(id: string) {
    dismissed = new Set([...dismissed, id]);
    try {
      sessionStorage.setItem(storageKey, JSON.stringify([...dismissed]));
    } catch {
      /* private mode: the dismissal lasts until the page reloads */
    }
  }

  function scan() {
    stopOnScreen = document.querySelector(SAFETY_STOP) !== null;
  }

  onMount(() => {
    dismissed = readDismissed();
    scan();
    observer = new MutationObserver(scan);
    observer.observe(document.body, { childList: true, subtree: true });
  });

  onDestroy(() => observer?.disconnect());

  const shown = $derived(stopOnScreen ? [] : nudges.filter((n) => !dismissed.has(n.id)));
</script>

{#if shown.length > 0}
  <details class="setup-nudges" aria-label={tr('setup.nudges.aria')} data-testid="setup-nudges">
    <summary>
      <span class="head">
        <span class="kicker"
          >{shown.length > 1
            ? tr('setup.nudges.kickerCount', { count: shown.length })
            : tr('setup.nudges.kicker')}</span
        >
        <span class="lead">{shown[0].title}</span>
      </span>
      <span class="chev" aria-hidden="true">▾</span>
    </summary>
    {#each shown as n (n.id)}
      <div class="nudge" data-nudge={n.id}>
        <div class="text">
          <strong>{n.title}</strong>
          <p>{n.body}</p>
        </div>
        <div class="actions">
          {#if n.ask && onAsk && n.action}
            <button type="button" class="go" onclick={() => onAsk(n.ask!)} data-ask={n.ask}>
              {n.action}
            </button>
          {:else if n.href && n.action}
            <a class="go" href={n.href}>{n.action}</a>
          {/if}
          <button
            type="button"
            class="later"
            onclick={() => dismiss(n.id)}
            aria-label={tr('setup.nudges.notNowAria', { title: n.title })}
          >
            {tr('setup.nudges.notNow')}
          </button>
        </div>
      </div>
    {/each}
  </details>
{/if}

<style>
  .setup-nudges {
    margin: 0 0 12px;
    border: 1px solid var(--color-divider, #e5e7e0);
    border-left: 4px solid var(--color-honey-deep, #6a4f00);
    border-radius: 8px;
    background: var(--color-honey-tint, #fff4d6);
  }
  summary {
    min-height: 48px;
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 0 12px;
    cursor: pointer;
    list-style-position: inside;
  }
  summary::-webkit-details-marker {
    display: none;
  }
  .chev {
    margin-left: auto;
    transition: transform 0.15s;
  }
  details[open] .chev {
    transform: rotate(180deg);
  }
  .head {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
    padding: 6px 0;
  }
  .kicker {
    font-size: 0.72rem;
    font-weight: 700;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--color-honey-deep, #6a4f00);
  }
  .lead {
    min-width: 0;
    overflow-wrap: anywhere;
    font-size: 0.9rem;
  }
  .nudge {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 8px 12px;
    padding: 10px 12px;
    border-top: 1px solid var(--color-divider, #e5e7e0);
    color: var(--color-ink, #2b2f27);
  }
  .text {
    flex: 1 1 16rem;
    min-width: 0;
  }
  .text p {
    margin: 2px 0 0;
    font-size: 0.9rem;
  }
  .actions {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
  }
  .go,
  .later {
    min-height: 48px;
    display: inline-flex;
    align-items: center;
    padding: 0 14px;
    border-radius: 6px;
    font: inherit;
    font-weight: 600;
    text-decoration: none;
    cursor: pointer;
  }
  .go {
    font-size: 1rem;
    background: var(--color-forest, #1f5e3a);
    color: var(--color-cream, #fff8e1);
    border: 1px solid var(--color-forest, #1f5e3a);
  }
  .later {
    background: transparent;
    color: var(--color-forest-deep, #1f3522);
    border: 1px solid var(--color-divider, #e5e7e0);
  }
</style>

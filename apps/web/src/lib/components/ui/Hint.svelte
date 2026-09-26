<script lang="ts">
  import { onDestroy, onMount, untrack } from 'svelte';
  import { page } from '$app/state';
  import { claimHint, hintState, initHints, markHintSeen, releaseHint } from '$lib/client/hints';
  import type { HintKey } from '$lib/hints';

  interface Props {
    key: HintKey;
    text: string;
    /** CSS selector of the control the bubble points at. */
    anchor: string;
    /** Parent-side reasons not to show right now (e.g. a modal is open). */
    suppressed?: boolean;
  }

  const { key, text, anchor, suppressed = false }: Props = $props();

  const SAFETY_STOP = '[data-safety-stop], [role="alertdialog"], .stop[role="alert"]';
  const WIDTH = 280;
  const GAP = 10;
  const MARGIN = 8;

  let mounted = $state(false);
  let anchorEl = $state<HTMLElement | null>(null);
  let stopOnScreen = $state(false);
  let pos = $state<{ top: number; left: number; arrow: number; above: boolean } | null>(null);
  let bubble = $state<HTMLDivElement | null>(null);

  const eligible = $derived(
    mounted &&
      $hintState.ready &&
      !$hintState.seen.has(key) &&
      !suppressed &&
      !stopOnScreen &&
      anchorEl !== null
  );
  let claimed = $state(false);

  $effect(() => {
    if (eligible) {
      claimed = claimHint(key);
    } else if (claimed) {
      releaseHint(key);
      claimed = false;
    }
  });

  const visible = $derived(claimed && $hintState.active === key && pos !== null);

  function scan() {
    anchorEl = document.querySelector<HTMLElement>(anchor);
    stopOnScreen = document.querySelector(SAFETY_STOP) !== null;
    place();
  }

  function place() {
    if (!anchorEl) {
      pos = null;
      return;
    }
    const r = anchorEl.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) {
      pos = null;
      return;
    }
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const width = Math.min(WIDTH, vw - MARGIN * 2);
    const centre = r.left + r.width / 2;
    const left = Math.max(MARGIN, Math.min(centre - width / 2, vw - width - MARGIN));
    const height = bubble?.offsetHeight ?? 120;
    const above = r.bottom + GAP + height > vh && r.top - GAP - height > 0;
    const next = {
      top: Math.round(above ? r.top - GAP - height : r.bottom + GAP),
      left: Math.round(left),
      arrow: Math.round(Math.max(16, Math.min(centre - left, width - 16))),
      above
    };
    if (
      !pos ||
      pos.top !== next.top ||
      pos.left !== next.left ||
      pos.arrow !== next.arrow ||
      pos.above !== next.above
    ) {
      pos = next;
    }
  }

  $effect(() => {
    if (bubble) untrack(place);
  });

  let observer: MutationObserver | null = null;
  let frame = 0;
  function schedule() {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(scan);
  }

  onMount(() => {
    mounted = true;
    void initHints(page.data?.user?.id ?? null);
    scan();
    observer = new MutationObserver(schedule);
    observer.observe(document.body, { childList: true, subtree: true });
    window.addEventListener('resize', schedule, { passive: true });
    window.addEventListener('scroll', schedule, { passive: true, capture: true });
  });

  onDestroy(() => {
    observer?.disconnect();
    if (typeof window !== 'undefined') {
      cancelAnimationFrame(frame);
      window.removeEventListener('resize', schedule);
      window.removeEventListener('scroll', schedule, { capture: true });
    }
    releaseHint(key);
  });

  function gotIt() {
    void markHintSeen(key);
    anchorEl?.focus?.();
  }
</script>

{#if visible && pos}
  <div
    class="hint"
    class:above={pos.above}
    bind:this={bubble}
    role="note"
    aria-label="Tip"
    data-hint={key}
    style:top="{pos.top}px"
    style:left="{pos.left}px"
    style:--arrow-x="{pos.arrow}px"
  >
    <p>{text}</p>
    <button type="button" onclick={gotIt}>Got it</button>
  </div>
{/if}

<style>
  .hint {
    position: fixed;
    z-index: 40;
    width: min(280px, calc(100vw - 16px));
    background: var(--color-forest-deep);
    color: var(--color-cream);
    border-radius: var(--radius-card);
    padding: 12px 14px 10px;
    box-shadow: 0 6px 18px rgba(26, 31, 26, 0.22);
    font-size: var(--font-size-body);
    line-height: 1.45;
  }
  .hint::before {
    content: '';
    position: absolute;
    top: -7px;
    left: calc(var(--arrow-x) - 7px);
    border: 7px solid transparent;
    border-top: 0;
    border-bottom-color: var(--color-forest-deep);
  }
  .hint.above::before {
    top: auto;
    bottom: -7px;
    border-bottom: 0;
    border-top: 7px solid var(--color-forest-deep);
  }
  p {
    margin: 0 0 8px;
  }
  button {
    font: inherit;
    font-weight: 600;
    min-height: 48px;
    min-width: 96px;
    padding: 0 16px;
    border-radius: var(--radius-input);
    border: 1px solid var(--color-cream);
    background: transparent;
    color: var(--color-cream);
    cursor: pointer;
    float: right;
  }
  button:focus-visible {
    outline: 2px solid var(--color-wheat-soft);
    outline-offset: 2px;
  }
  .hint::after {
    content: '';
    display: block;
    clear: both;
  }
  @media print {
    .hint {
      display: none;
    }
  }
</style>

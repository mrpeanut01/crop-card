<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import { page } from '$app/state';
  import { ArrowRight, Sprout } from 'lucide-svelte';
  import { createT } from '$lib/i18n';
  import { hintState, initHints, markHintSeen, setTipShowing } from '$lib/client/hints';
  import { watchSafetyStop } from '$lib/client/safetyStop';
  import { START_GUIDE_HREF, tipContent, tipVisible, type TipId } from '$lib/tips';

  interface Props {
    tip: TipId;
    /** Parent-side reasons not to show right now. */
    suppressed?: boolean;
  }

  const { tip, suppressed = false }: Props = $props();
  const tr = $derived(createT(page.data?.locale));
  const content = $derived(tipContent(tip, page.data?.user?.role));

  let stopOnScreen = $state(false);
  let unwatch: (() => void) | null = null;

  const visible = $derived(
    tipVisible({
      enabled: page.data?.beginnerTips,
      key: content.key,
      serverSeen: page.data?.seenTips,
      localSeen: $hintState.seen,
      stopOnScreen,
      suppressed
    })
  );

  $effect(() => {
    const key = content.key;
    setTipShowing(key, visible);
    return () => setTipShowing(key, false);
  });

  onMount(() => {
    if (!page.data?.beginnerTips) return;
    void initHints(page.data?.user?.id ?? null);
    unwatch = watchSafetyStop((on) => (stopOnScreen = on));
  });

  onDestroy(() => unwatch?.());

  function gotIt() {
    void markHintSeen(content.key);
  }
</script>

{#if visible}
  <aside
    class="tip"
    aria-labelledby="beginner-tip-{tip}"
    data-testid="beginner-tip"
    data-tip={content.key}
  >
    <div class="kicker">
      <Sprout size={14} strokeWidth={2} aria-hidden="true" />
      {tr('tips.kicker')}
    </div>
    <p id="beginner-tip-{tip}" class="title serif">{tr(content.title)}</p>
    <p>{tr(content.body)}</p>
    <div class="foot">
      <div class="links">
        {#if content.action}
          <a class="first" href={content.action.href}>
            {tr(content.action.label)}
            <ArrowRight size={15} aria-hidden="true" />
          </a>
        {/if}
        <a class="guide" href={START_GUIDE_HREF}>{tr('tips.howToStart')}</a>
      </div>
      <button type="button" onclick={gotIt}>{tr('ui.hint.gotIt')}</button>
    </div>
  </aside>
{/if}

<style>
  .tip {
    background: var(--pill-forest-bg);
    border: 1px solid var(--color-divider);
    border-left: 6px solid var(--color-forest);
    border-radius: var(--radius-card);
    padding: 14px 16px 12px;
    margin: 0 0 16px;
    max-width: 100%;
    box-sizing: border-box;
  }
  .kicker {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: var(--font-size-kicker);
    text-transform: uppercase;
    letter-spacing: 0.08em;
    font-weight: 700;
    color: var(--color-forest-deep);
  }
  .title {
    margin: 4px 0 4px;
    max-width: none;
    font-size: 20px;
    line-height: 1.25;
    color: var(--color-forest-deep);
    letter-spacing: var(--letter-tight);
  }
  p {
    margin: 0;
    max-width: 68ch;
    color: var(--color-ink);
    font-size: var(--font-size-body);
    line-height: 1.5;
  }
  .foot {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 4px 16px;
    margin-top: 6px;
  }
  .links {
    display: flex;
    flex-wrap: wrap;
    gap: 0 20px;
  }
  a {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    min-height: 48px;
    font-weight: 600;
    color: var(--color-forest-deep);
  }
  a.first {
    text-decoration: none;
  }
  a.guide {
    text-decoration: underline;
    text-underline-offset: 3px;
  }
  a.first:hover {
    text-decoration: underline;
  }
  button {
    font: inherit;
    font-weight: 600;
    min-height: 48px;
    min-width: 96px;
    padding: 0 18px;
    margin-left: auto;
    border-radius: var(--radius-input);
    border: 1px solid var(--color-forest);
    background: var(--color-forest);
    color: var(--color-cream);
    cursor: pointer;
  }
  a:focus-visible,
  button:focus-visible {
    outline: 2px solid var(--color-forest-deep);
    outline-offset: 2px;
  }
  @media print {
    .tip {
      display: none;
    }
  }
</style>

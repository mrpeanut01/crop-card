<script lang="ts">
  import Provenance from '$lib/components/ui/Provenance.svelte';
  import SetupSheet from '$lib/components/setup/SetupSheet.svelte';
  import WateringSheet from './WateringSheet.svelte';
  import {
    ADVICE_VISIBLE_PER_KIND,
    type AdviceSheet,
    type TodayAdviceCard
  } from '$lib/today/advice';

  interface Props {
    cards: TodayAdviceCard[];
    /** Called after a sheet saved, so the page can reload the cards. */
    onSaved?: (message: string) => void;
  }

  const { cards, onSaved }: Props = $props();

  let expanded = $state<string[]>([]);
  let sheet = $state<{ sheet: AdviceSheet; fieldId: string } | null>(null);
  let message = $state<string | null>(null);

  const groups = $derived.by(() => {
    const byKind = new Map<string, TodayAdviceCard[]>();
    for (const c of cards) byKind.set(c.kind, [...(byKind.get(c.kind) ?? []), c]);
    return [...byKind.entries()].map(([kind, list]) => ({
      kind,
      shown: expanded.includes(kind) ? list : list.slice(0, ADVICE_VISIBLE_PER_KIND),
      hidden: expanded.includes(kind) ? 0 : Math.max(0, list.length - ADVICE_VISIBLE_PER_KIND)
    }));
  });

  const SHEET_TITLE: Record<AdviceSheet, string> = {
    'log-watering': 'Log watering',
    'rain-gauge': 'Enter rain gauge'
  };

  function done(text: string) {
    sheet = null;
    message = text;
    onSaved?.(text);
  }
</script>

{#if cards.length > 0 || message}
  <section class="advice" aria-labelledby="advice-heading" data-testid="today-advice">
    <h2 id="advice-heading" class="serif">Growing advice</h2>
    {#if message}<p class="saved" role="status">{message}</p>{/if}
    {#each groups as g (g.kind)}
      {#each g.shown as card (card.id)}
        <article
          class="advice-card tone-{card.tone}"
          data-testid="advice-card"
          data-kind={card.kind}
          data-id={card.id}
        >
          <h3>{card.title}</h3>
          {#each card.lines as line, i (i)}
            <p class="line">{line}</p>
          {/each}
          <p class="meta">
            <Provenance source={card.provenance} detail={card.detail} />
          </p>
          {#if card.actions.length > 0}
            <div class="actions">
              {#each card.actions as a (a.label)}
                {#if a.kind === 'link'}
                  <a class="btn" href={a.href}>{a.label}</a>
                {:else}
                  <button
                    type="button"
                    class="btn"
                    onclick={() => (sheet = { sheet: a.sheet, fieldId: a.fieldId })}
                  >
                    {a.label}
                  </button>
                {/if}
              {/each}
            </div>
          {/if}
        </article>
      {/each}
      {#if g.hidden > 0}
        <button type="button" class="more" onclick={() => (expanded = [...expanded, g.kind])}>
          Show {g.hidden} more
        </button>
      {/if}
    {/each}
  </section>
{/if}

<SetupSheet
  open={sheet !== null}
  title={sheet ? SHEET_TITLE[sheet.sheet] : ''}
  kicker="Watering"
  onClose={() => (sheet = null)}
>
  {#if sheet}
    <WateringSheet mode={sheet.sheet} fieldId={sheet.fieldId} onDone={done} />
  {/if}
</SetupSheet>

<style>
  .advice {
    margin-bottom: 1rem;
  }
  .advice h2 {
    margin: 0 0 0.5rem;
    font-size: 1.1rem;
    color: var(--color-forest-deep);
  }
  .advice-card {
    background: var(--color-paper);
    border: 1px solid var(--color-divider-soft);
    border-left: 4px solid var(--color-sky);
    border-radius: var(--radius-card);
    padding: 0.85rem 1rem;
    margin-bottom: 0.75rem;
    overflow-wrap: anywhere;
  }
  .advice-card.tone-wheat {
    border-left-color: var(--color-wheat);
    background: var(--color-wheat-soft);
  }
  h3 {
    margin: 0 0 0.35rem;
    font-size: 1rem;
    color: var(--color-ink);
  }
  .line {
    margin: 0 0 0.25rem;
    color: var(--color-ink);
  }
  .meta {
    margin: 0.4rem 0 0;
    font-size: 0.85rem;
    color: var(--color-ink-soft);
  }
  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
    margin-top: 0.6rem;
  }
  .btn,
  .more {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-height: 48px;
    padding: 0 1rem;
    border-radius: 999px;
    border: 1px solid var(--color-divider);
    background: var(--color-paper);
    color: var(--color-forest-deep);
    font-weight: 600;
    font-size: 0.95rem;
    cursor: pointer;
    text-decoration: none;
  }
  .saved {
    margin: 0 0 0.5rem;
    color: var(--color-forest-deep);
    font-weight: 600;
  }
</style>

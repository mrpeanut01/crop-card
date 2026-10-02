<script lang="ts">
  import { page } from '$app/state';
  import { createT } from '$lib/i18n';
  import Provenance from '$lib/components/ui/Provenance.svelte';
  import type { ForageAdvisory, ForageTestView } from '$lib/forage/advisory';
  import { FORAGE_FROST_UNKNOWN_TEXT } from '$lib/farm/forageAdvisory';

  interface Props {
    advisory: ForageAdvisory | null;
    failed?: boolean;
    loading?: boolean;
    /** Names the Area, for the move sheet ("At Back pasture"). */
    where?: string | null;
    /** Shows the target's own latest test (the hay card). */
    showTargetTest?: boolean;
    /** Start open (the hay card); the move sheet starts folded. */
    open?: boolean;
  }

  const {
    advisory,
    failed = false,
    loading = false,
    where = null,
    showTargetTest = false,
    open = false
  }: Props = $props();
  const tr = $derived(createT(page.data?.locale));

  const items = $derived(advisory?.items ?? []);
  const elevated = $derived(items.some((i) => i.elevated));
  const summary = $derived.by(() => {
    if (items.length === 0) return null;
    const kinds = new Set(items.map((i) => i.hazard));
    const what =
      kinds.size === 2
        ? 'prussic acid and nitrate'
        : kinds.has('prussic-acid')
          ? 'prussic acid'
          : 'nitrate';
    const lead = elevated ? `Higher ${what} risk` : `Forage check: ${what}`;
    return where ? `At ${where}: ${lead}` : lead;
  });
  const targetTest = $derived(showTargetTest ? (advisory?.targetTest ?? null) : null);
</script>

{#snippet test(t: ForageTestView)}
  <div class="test" data-testid="forage-latest-test">
    {#if t.ratingText}
      <p class="rating">
        {t.ratingText}
        <Provenance source="manual" compact />
      </p>
    {/if}
    {#if t.valueText}<p>{t.valueText}</p>{/if}
    {#if t.convertedText}<p class="muted">{t.convertedText}</p>{/if}
  </div>
{/snippet}

{#if loading}
  <p class="muted" aria-live="polite">{tr('forage.panel.checking')}</p>
{:else if failed}
  <p class="failed" role="status" data-testid="forage-advisory-failed">
    {tr('forage.panel.failed')}
  </p>
{:else if summary}
  <details class="forage" class:elevated data-testid="forage-advisory" {open}>
    <summary>
      <span class="line">{summary}</span>
      <Provenance source={advisory?.provenance ?? 'plugin'} compact />
    </summary>
    {#each items as item, i (i)}
      <section class="item">
        <h4>{item.headline}</h4>
        {#if item.triggersOnFile.length || item.frostUnknown}
          <ul>
            {#each item.triggersOnFile as t, j (j)}
              <li>{t.text}</li>
            {/each}
            {#if item.frostUnknown}<li>{FORAGE_FROST_UNKNOWN_TEXT}</li>{/if}
          </ul>
        {/if}
        <p class="muted">{item.raisesRisk}</p>
        {#if item.advice.length}
          <p class="lead">{tr('forage.panel.lead')}</p>
          <ul class="advice">
            {#each item.advice as a (a.id)}
              <li>
                {a.text}
                <a href={a.url} target="_blank" rel="noopener noreferrer nofollow"
                  >{tr('forage.panel.source')}</a
                >
              </li>
            {/each}
          </ul>
        {/if}
        {#if item.latestTest && item.latestTest.id !== targetTest?.id}
          {@render test(item.latestTest)}
        {/if}
      </section>
    {/each}
    {#if targetTest}{@render test(targetTest)}{/if}
    <p class="muted">{tr('forage.panel.foot')}</p>
  </details>
{:else if targetTest}
  {@render test(targetTest)}
{/if}

<style>
  .forage {
    border: 1px solid var(--color-divider);
    border-left: 4px solid var(--color-wheat-deep, var(--color-divider));
    border-radius: var(--radius-card);
    background: var(--color-paper);
    padding: 0 var(--space-3);
    min-width: 0;
  }
  .forage.elevated {
    border-left-color: var(--color-rust);
  }
  summary {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-1) var(--space-2);
    min-height: 48px;
    cursor: pointer;
    font-weight: 600;
    color: var(--color-ink);
  }
  .line {
    min-width: 0;
    overflow-wrap: anywhere;
  }
  .item {
    padding-bottom: var(--space-2);
    overflow-wrap: anywhere;
  }
  h4 {
    margin: var(--space-2) 0 var(--space-1);
    font-size: var(--font-size-body);
    color: var(--color-ink);
  }
  ul {
    margin: 0;
    padding-left: 1.1em;
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    color: var(--color-ink-soft);
  }
  .advice a {
    display: inline-flex;
    align-items: center;
    min-height: 48px;
    padding: 0 var(--space-1);
    color: var(--color-forest);
  }
  p {
    margin: var(--space-1) 0;
  }
  .lead {
    font-weight: 600;
    color: var(--color-ink);
  }
  .muted {
    font-size: var(--font-size-caption);
    color: var(--color-ink-soft);
  }
  .failed {
    margin: 0;
    color: var(--color-ink-soft);
  }
  .test {
    border-top: 1px solid var(--color-divider);
    padding-top: var(--space-1);
    overflow-wrap: anywhere;
  }
  .rating {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-1);
    font-weight: 600;
    color: var(--color-ink);
  }
</style>

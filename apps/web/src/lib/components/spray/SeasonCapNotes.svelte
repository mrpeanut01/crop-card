<script lang="ts">
  import { page } from '$app/state';
  import { createT } from '$lib/i18n';
  import { earlierLabelNotice, type EarlierLabel } from '$lib/plugins/earlierRegistration';
  import { seasonCapVerdictLines, type SeasonCapVerdictLike } from '$lib/spray/seasonCapText';

  interface Props {
    /** #820: the kernel's season cap verdicts for one block. */
    verdicts: Array<SeasonCapVerdictLike & { earlierLabels?: EarlierLabel[] }>;
    /** The block the verdicts are for, when the pass covers several. */
    blockLabel?: string;
  }
  const { verdicts, blockLabel }: Props = $props();
  const locale = $derived(page.data?.locale);
  const tr = $derived(createT(locale));
</script>

{#if verdicts.length > 0}
  <section class="season-caps" data-testid="season-caps">
    <h4>
      {tr('sprayui.seasonCap.title')}{#if blockLabel}<span class="block">{blockLabel}</span>{/if}
    </h4>
    {#each verdicts as v (`${v.pluginId}|${v.cap.amount}|${v.cap.unit}|${v.cap.period}`)}
      {@const lines = seasonCapVerdictLines(v, locale)}
      <div
        class="verdict {v.status}"
        data-status={v.status}
        role={v.status === 'over' ? 'alert' : undefined}
      >
        <p><strong>{lines.headline}</strong></p>
        {#each lines.reasons as reason (reason)}
          <p>{reason}</p>
        {/each}
        <p class="note">{lines.note}</p>
        {#each v.earlierLabels ?? [] as label (`${label.registration}|${label.year}`)}
          <p class="note">{earlierLabelNotice(label, locale)}</p>
        {/each}
      </div>
    {/each}
  </section>
{/if}

<style>
  .season-caps {
    margin: 0.75rem 0;
  }
  h4 {
    margin: 0 0 0.35rem;
  }
  .block {
    font-weight: 400;
    margin-left: 0.35rem;
  }
  .block::before {
    content: '· ';
  }
  .verdict {
    border-left: 4px solid var(--color-rule, #999);
    padding: 0.4rem 0.6rem;
    margin: 0.4rem 0;
    background: var(--color-surface-2, transparent);
  }
  .verdict.over {
    border-left-color: var(--color-danger, #b3261e);
  }
  .verdict.unknown {
    border-left-color: var(--color-warn, #a86b00);
  }
  .verdict.within {
    border-left-color: var(--color-ok, #2e7d32);
  }
  p {
    margin: 0.2rem 0;
  }
  .note {
    font-size: 0.9rem;
  }
</style>

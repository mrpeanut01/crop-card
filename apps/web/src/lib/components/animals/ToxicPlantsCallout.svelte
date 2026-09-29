<script lang="ts">
  import Provenance from '$lib/components/ui/Provenance.svelte';
  import {
    TOXIC_ADVICE,
    pluralFrom,
    toxicFindings,
    toxicLines,
    toxicSummary,
    type ToxicCrop
  } from '$lib/animals/toxicAdjacency';

  interface Props {
    crops: readonly ToxicCrop[] | null | undefined;
    speciesIds: readonly string[];
    speciesPlural: Readonly<Record<string, string>>;
    /** Names the Area, for the move sheet ("At Back Pasture"). */
    where?: string | null;
  }

  const { crops, speciesIds, speciesPlural, where = null }: Props = $props();
  const plural = $derived(pluralFrom(speciesPlural));
  const findings = $derived(toxicFindings(crops, speciesIds));
  const summary = $derived(toxicSummary(findings, plural));
  const lines = $derived(toxicLines(findings, plural));
</script>

{#if summary}
  <details class="toxic" data-testid="toxic-plants">
    <summary>
      <span class="line">{where ? `At ${where}: ${summary}` : summary}</span>
      <Provenance source="plugin" compact />
    </summary>
    <ul>
      {#each lines as line, i (i)}
        <li>{line}</li>
      {/each}
    </ul>
    <p class="advice">{TOXIC_ADVICE}</p>
  </details>
{/if}

<style>
  .toxic {
    border: 1px solid var(--color-wheat-deep, var(--color-divider));
    border-left-width: 4px;
    border-radius: var(--radius-card);
    background: var(--color-paper);
    padding: 0 var(--space-3);
    min-width: 0;
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
  ul {
    margin: 0;
    padding-left: 1.1em;
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    color: var(--color-ink-soft);
    overflow-wrap: anywhere;
  }
  .advice {
    margin: var(--space-2) 0 var(--space-3);
    font-size: var(--font-size-caption);
    color: var(--color-ink-soft);
  }
</style>

<script lang="ts">
  import { X } from 'lucide-svelte';
  import { page } from '$app/state';
  import { createT } from '$lib/i18n';
  import { cropDisplayName } from '$lib/i18n/cropName';
  import Provenance from '$lib/components/ui/Provenance.svelte';
  import ToxicPlantsCallout from '$lib/components/animals/ToxicPlantsCallout.svelte';
  import type { ToxicCrop } from '$lib/animals/toxicAdjacency';
  import { becauseText } from '$lib/garden/brief/shortlist';
  import type { BriefSun, ShortlistRow } from '$lib/garden/brief/schema';
  import { sunFit, sunLine, type HerbSunNeed } from '$lib/garden/brief/sun';

  interface HerbOption {
    pluginId: string;
    displayName: string;
    sunNeed?: HerbSunNeed;
  }

  interface Props {
    rows: readonly ShortlistRow[];
    herbs: readonly HerbOption[];
    lifecycle?: Readonly<
      Record<string, { text: string; provenance: 'plugin' | 'manual' | 'fallback' } | null>
    >;
    /** The owner's sun answer; a herb that wants more sun reads as a
     *  mismatch (CO-5). */
    sun?: BriefSun | null;
    toxic?: Readonly<Record<string, ToxicCrop>>;
    petSpecies?: readonly string[];
    speciesPlural?: Readonly<Record<string, string>>;
    canEdit?: boolean;
    busy?: boolean;
    onRemove?: (pluginId: string) => void;
  }

  const {
    rows,
    herbs,
    lifecycle = {},
    sun = null,
    toxic = {},
    petSpecies = [],
    speciesPlural = {},
    canEdit = false,
    busy = false,
    onRemove
  }: Props = $props();

  const tr = $derived(createT(page.data?.locale));
  const locale = $derived(page.data?.locale ?? null);

  function nameOf(id: string): string {
    const h = herbs.find((x) => x.pluginId === id);
    return h ? cropDisplayName(h.pluginId, h.displayName, locale) : id;
  }

  function needOf(id: string): HerbSunNeed | undefined {
    return herbs.find((x) => x.pluginId === id)?.sunNeed;
  }

  function because(row: ShortlistRow): string {
    return row.reasons?.length ? becauseText(row.reasons, locale) : row.because;
  }
</script>

<ul class="shortlist" data-testid="brief-shortlist">
  {#each rows as row (row.cropPluginId)}
    {@const life = lifecycle[row.cropPluginId] ?? null}
    {@const need = needOf(row.cropPluginId)}
    {@const sunText = sunLine(need, sun, locale)}
    <li class="row" data-plugin={row.cropPluginId} data-testid="brief-row">
      <div class="head">
        <h3 class="serif">{nameOf(row.cropPluginId)}</h3>
        {#if canEdit && onRemove}
          <button
            type="button"
            class="remove"
            disabled={busy}
            aria-label={tr('herbsa.result.remove', { name: nameOf(row.cropPluginId) })}
            onclick={() => onRemove(row.cropPluginId)}><X size={18} aria-hidden="true" /></button
          >
        {/if}
      </div>
      <p class="because">
        {#if row.reasons?.length}
          <span>{because(row)}</span>
        {:else}
          <span lang="en">{because(row)}</span>
        {/if}
        <Provenance source={row.provenance} compact />
      </p>
      <p class="life" data-testid="lifecycle-line">
        <span>{life ? life.text : tr('herbsa.result.lifecycleUnknown')}</span>
        <Provenance source={life ? life.provenance : 'fallback'} compact />
      </p>
      {#if sunText}
        <p
          class="sun"
          class:mismatch={sunFit(need, sun) === 'mismatch'}
          data-testid="sun-line"
          data-fit={sunFit(need, sun)}
        >
          <span>{sunText}</span>
          <Provenance source="plugin" compact />
        </p>
      {/if}
      {#if toxic[row.cropPluginId] && petSpecies.length > 0}
        <ToxicPlantsCallout
          crops={[toxic[row.cropPluginId]]}
          speciesIds={petSpecies}
          {speciesPlural}
        />
      {/if}
    </li>
  {/each}
</ul>

<style>
  .shortlist {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: var(--space-2);
  }
  .row {
    border: 1px solid var(--color-rule);
    border-radius: var(--radius-card, 12px);
    padding: var(--space-2) var(--space-3);
    background: var(--color-paper, #fff);
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    min-width: 0;
  }
  .head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-2);
  }
  h3 {
    margin: 0;
    font-size: 1.05rem;
  }
  .because,
  .life,
  .sun {
    margin: 0;
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-1) var(--space-2);
    overflow-wrap: anywhere;
  }
  .life,
  .sun {
    color: var(--color-ink-soft);
    font-size: 0.92rem;
  }
  .sun.mismatch {
    color: var(--color-rust, var(--color-ink));
    font-weight: 600;
  }
  .remove {
    min-height: 48px;
    min-width: 48px;
    border: 1px solid var(--color-rule);
    border-radius: var(--radius-input);
    background: transparent;
    color: var(--color-ink);
    cursor: pointer;
  }
</style>

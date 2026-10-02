<script lang="ts">
  import { onMount } from 'svelte';
  import { createT } from '$lib/i18n';
  import { page } from '$app/state';
  import Provenance from '$lib/components/ui/Provenance.svelte';
  import SetupSheet from './SetupSheet.svelte';
  import SetupProtection from './SetupProtection.svelte';
  import { HARD_FREEZE_NOTE, PROTECTION_LABEL } from '$lib/climate/protection';
  import {
    fetchBlockCovers,
    removeBlockCover,
    shiftText,
    type BlockCoversResponse,
    type BlockProtectionView
  } from '$lib/climate/protectionView';
  import { formatDay } from '$lib/plan/plantingWindow';

  interface Props {
    blockId: string;
    blockName: string;
    canEdit: boolean;
    seasonYear?: number;
    /** Called after the covers change, with the bed's new frost. */
    onChange?: (result: BlockCoversResponse) => void;
  }

  const { blockId, blockName, canEdit, seasonYear, onChange }: Props = $props();

  const tr = $derived(createT(page.data?.locale));

  let data = $state<BlockCoversResponse | null>(null);
  let loadError = $state<string | null>(null);
  let actionError = $state<string | null>(null);
  let sheetOpen = $state(false);
  let removing = $state<string | null>(null);

  async function load() {
    try {
      data = await fetchBlockCovers(blockId, seasonYear);
      loadError = null;
    } catch (e) {
      loadError = e instanceof Error ? e.message : String(e);
    }
  }

  onMount(() => {
    void load();
  });

  function dayOf(ms: number | null): string | null {
    if (ms === null) return null;
    const d = new Date(ms);
    const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    return formatDay(iso);
  }

  function datesText(p: BlockProtectionView): string {
    const on = dayOf(p.installedOn);
    const off = dayOf(p.removedOn);
    const season =
      p.seasonYear === null
        ? tr('setup.chips.everyYear')
        : tr('setup.chips.seasonOf', { year: p.seasonYear });
    if (on && off) return tr('setup.chips.range', { on, off, season });
    if (on) return tr('setup.chips.from', { on, season });
    if (off) return tr('setup.chips.until', { off, season });
    return season;
  }

  async function remove(p: BlockProtectionView) {
    if (!canEdit) return;
    removing = p.id;
    actionError = null;
    try {
      await removeBlockCover(blockId, p.id);
      await load();
      if (data) onChange?.(data);
    } catch (e) {
      actionError = e instanceof Error ? e.message : String(e);
    } finally {
      removing = null;
    }
  }

  function added(result: BlockCoversResponse) {
    data = result;
    sheetOpen = false;
    onChange?.(result);
  }
</script>

<section class="cover-chips" aria-label={tr('setup.chips.aria', { name: blockName })}>
  <h3 class="title">{tr('setup.chips.title')}</h3>
  {#if loadError}
    <p class="error" role="alert">{loadError}</p>
  {:else if !data}
    <p class="muted">{tr('setup.chips.loading')}</p>
  {:else}
    {#if data.protections.length === 0}
      <p class="muted">{tr('setup.chips.none')}</p>
    {:else}
      <ul class="chips">
        {#each data.protections as p (p.id)}
          <li class="chip" data-testid="cover-chip">
            <div class="chip-main">
              <strong>{PROTECTION_LABEL[p.kind]}</strong>
              {#if p.kind === 'greenhouse-heated'}
                <span>{tr('setup.chips.noLimit')}</span>
              {:else}
                <span>
                  {shiftText('spring', p.springShiftDays)} · {shiftText('fall', p.fallShiftDays)}
                  {#if p.springShiftDays !== null || p.fallShiftDays !== null}
                    <Provenance source={p.provenance} compact />
                  {/if}
                </span>
              {/if}
              <span class="dates">{datesText(p)}</span>
            </div>
            {#if canEdit}
              <button
                type="button"
                class="remove"
                aria-label={tr('setup.chips.removeAria', { name: PROTECTION_LABEL[p.kind] })}
                disabled={removing === p.id}
                onclick={() => remove(p)}>{tr('setup.chips.remove')}</button
              >
            {/if}
          </li>
        {/each}
      </ul>
    {/if}
    {#if data.frost.summary}
      <p class="summary" data-testid="bed-frost-summary">{data.frost.summary}</p>
    {/if}
    {#if data.protections.length > 0}
      <p class="muted small">{HARD_FREEZE_NOTE}</p>
    {/if}
    {#if actionError}<p class="error" role="alert">{actionError}</p>{/if}
    {#if canEdit}
      <button type="button" class="add" onclick={() => (sheetOpen = true)}
        >{tr('setup.chips.add')}</button
      >
    {:else}
      <p class="muted small">{tr('setup.chips.askOwner')}</p>
    {/if}
  {/if}
</section>

<SetupSheet
  open={sheetOpen}
  title={tr('setup.chips.sheetTitle')}
  kicker={blockName}
  onClose={() => (sheetOpen = false)}
>
  <SetupProtection
    {blockId}
    {blockName}
    {canEdit}
    seasonYear={data?.seasonYear ?? seasonYear ?? new Date().getFullYear()}
    onDone={added}
  />
</SetupSheet>

<style>
  .cover-chips {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    min-width: 0;
  }
  .title {
    margin: 0;
    font-size: var(--font-size-body);
    font-weight: 600;
  }
  .chips {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }
  .chip {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-2);
    padding: var(--space-2) var(--space-3);
    border: 1px solid var(--color-divider);
    border-radius: var(--radius-card);
    background: var(--pill-forest-bg, var(--color-paper));
    min-width: 0;
  }
  .chip-main {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
    overflow-wrap: anywhere;
  }
  .dates,
  .small {
    font-size: var(--font-size-caption);
    color: var(--color-ink-muted);
  }
  .summary {
    margin: 0;
    font-weight: 600;
    color: var(--color-forest-deep);
  }
  .muted {
    margin: 0;
    color: var(--color-ink-muted);
  }
  .remove,
  .add {
    min-height: 48px;
    min-width: 48px;
    padding: 0 var(--space-3);
    border: 1px solid var(--color-divider);
    border-radius: var(--radius-input);
    background: var(--color-paper);
    font: inherit;
    font-weight: 600;
    color: var(--color-ink);
    cursor: pointer;
    flex: none;
  }
  .add {
    align-self: flex-start;
    color: var(--color-forest-deep);
  }
  .error {
    margin: 0;
    color: var(--color-rust);
  }
</style>

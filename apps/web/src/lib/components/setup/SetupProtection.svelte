<script lang="ts">
  import { untrack } from 'svelte';
  import { createT } from '$lib/i18n';
  import { page } from '$app/state';
  import Provenance from '$lib/components/ui/Provenance.svelte';
  import {
    MAX_SHIFT_DAYS,
    PROTECTION_KINDS,
    hardFreezeNote,
    protectionDefaults,
    protectionLabel,
    shiftUnknownNote,
    type ProtectionKind
  } from '$lib/climate/protection';
  import { addBlockCover, type BlockCoversResponse } from '$lib/climate/protectionView';

  interface Props {
    blockId: string;
    blockName: string;
    canEdit: boolean;
    seasonYear: number;
    initialKind?: ProtectionKind;
    onDone: (result: BlockCoversResponse) => void;
  }

  const { blockId, blockName, canEdit, seasonYear, initialKind, onDone }: Props = $props();
  const tr = $derived(createT(page.data?.locale));
  const uid = $props.id();

  let kind = $state<ProtectionKind>(untrack(() => initialKind ?? 'row-cover'));
  const defaults = $derived(protectionDefaults(kind));
  let springDays = $state<number | null>(null);
  let fallDays = $state<number | null>(null);
  let thisSeasonOnly = $state(true);
  let installedOn = $state('');
  let removedOn = $state('');
  let saving = $state(false);
  let error = $state<string | null>(null);

  $effect(() => {
    const d = protectionDefaults(kind);
    untrack(() => {
      springDays = d.springShiftDays;
      fallDays = d.fallShiftDays;
    });
  });

  const heated = $derived(kind === 'greenhouse-heated');
  const typed = $derived(
    springDays !== defaults.springShiftDays || fallDays !== defaults.fallShiftDays
  );

  function dayMs(v: string): number | null {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return null;
    const [y, m, d] = v.split('-').map(Number);
    return new Date(y, m - 1, d).getTime();
  }

  function validDays(n: number | null): boolean {
    return n === null || (Number.isInteger(n) && n >= 0 && n <= MAX_SHIFT_DAYS);
  }

  async function submit(e: SubmitEvent) {
    e.preventDefault();
    error = null;
    if (!heated && (!validDays(springDays) || !validDays(fallDays))) {
      error = tr('setup.cover.errDays', { max: MAX_SHIFT_DAYS });
      return;
    }
    const inst = dayMs(installedOn);
    const rem = dayMs(removedOn);
    if (inst !== null && rem !== null && rem <= inst) {
      error = tr('setup.cover.errDates');
      return;
    }
    saving = true;
    try {
      const result = await addBlockCover(
        blockId,
        {
          kind,
          ...(heated || !typed ? {} : { springShiftDays: springDays, fallShiftDays: fallDays }),
          installedOn: inst,
          removedOn: rem,
          seasonYear: thisSeasonOnly ? seasonYear : null
        },
        seasonYear
      );
      onDone(result);
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    } finally {
      saving = false;
    }
  }
</script>

{#if !canEdit}
  <p class="ask-owner" role="note">{tr('setup.cover.askOwner', { name: blockName })}</p>
{:else}
  <form class="setup-protection" onsubmit={submit}>
    <p class="lede">
      {tr('setup.cover.lede')}
      {hardFreezeNote(page.data?.locale)}
    </p>

    <label for="sp-kind-{uid}">{tr('setup.cover.kind')}</label>
    <select id="sp-kind-{uid}" bind:value={kind} data-autofocus>
      {#each PROTECTION_KINDS as k (k)}
        <option value={k}>{protectionLabel(k, page.data?.locale)}</option>
      {/each}
    </select>

    {#if heated}
      <p class="help">{tr('setup.cover.heatedHelp')}</p>
    {:else}
      {#if defaults.springShiftDays === null || defaults.fallShiftDays === null}
        <p class="help" role="note">{shiftUnknownNote(page.data?.locale)}</p>
      {/if}
      <div class="shift-row">
        <label>
          <span>{tr('setup.cover.spring')}</span>
          <input
            type="number"
            inputmode="numeric"
            min="0"
            max={MAX_SHIFT_DAYS}
            step="1"
            bind:value={springDays}
            aria-describedby="sp-spring-prov-{uid}"
          />
          <span id="sp-spring-prov-{uid}" class="prov">
            {#if springDays !== null}
              <Provenance
                source={springDays === defaults.springShiftDays ? 'data' : 'manual'}
                compact
              />
            {/if}
          </span>
        </label>
        <label>
          <span>{tr('setup.cover.fall')}</span>
          <input
            type="number"
            inputmode="numeric"
            min="0"
            max={MAX_SHIFT_DAYS}
            step="1"
            bind:value={fallDays}
          />
          <span class="prov">
            {#if fallDays !== null}
              <Provenance
                source={fallDays === defaults.fallShiftDays ? 'data' : 'manual'}
                compact
              />
            {/if}
          </span>
        </label>
      </div>
    {/if}

    <label class="check">
      <input type="checkbox" bind:checked={thisSeasonOnly} />
      <span>{tr('setup.cover.seasonOnly', { year: seasonYear })}</span>
    </label>
    <p class="help">{tr('setup.cover.everyYear')}</p>

    <div class="shift-row">
      <label>
        <span>{tr('setup.cover.goesOn')} <span class="optional">{tr('setup.optional')}</span></span>
        <input type="date" bind:value={installedOn} />
      </label>
      <label>
        <span
          >{tr('setup.cover.comesOff')} <span class="optional">{tr('setup.optional')}</span></span
        >
        <input type="date" bind:value={removedOn} />
      </label>
    </div>

    {#if error}<p class="error" role="alert">{error}</p>{/if}
    <button class="primary" type="submit" disabled={saving}>
      {saving ? tr('setup.saving') : tr('setup.cover.add')}
    </button>
  </form>
{/if}

<style>
  .setup-protection {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }
  .lede,
  .help {
    margin: 0;
    color: var(--color-ink-soft);
  }
  .help {
    font-size: var(--font-size-caption);
  }
  label {
    font-weight: 600;
    color: var(--color-ink);
  }
  select,
  input[type='number'],
  input[type='date'] {
    min-height: 48px;
    padding: 0 var(--space-3);
    border: 1px solid var(--color-divider);
    border-radius: var(--radius-input);
    background: var(--color-paper);
    font: inherit;
    font-size: 16px;
    color: var(--color-ink);
    width: 100%;
    box-sizing: border-box;
  }
  .shift-row {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
    gap: var(--space-2);
  }
  .shift-row label {
    display: flex;
    flex-direction: column;
    gap: 4px;
    font-weight: 500;
    min-width: 0;
  }
  .prov {
    min-height: 20px;
  }
  .check {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    min-height: 48px;
    font-weight: 500;
  }
  .check input {
    width: 24px;
    height: 24px;
  }
  .optional {
    font-weight: 400;
    color: var(--color-ink-muted);
  }
  .primary {
    min-height: 48px;
    margin-top: var(--space-2);
    border: none;
    border-radius: var(--radius-input);
    background: var(--color-forest);
    color: var(--color-cream);
    font: inherit;
    font-weight: 600;
    cursor: pointer;
  }
  .primary:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }
  .error {
    margin: 0;
    color: var(--color-rust);
  }
  .ask-owner {
    margin: 0;
    color: var(--color-ink-soft);
  }
</style>

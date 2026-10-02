<script lang="ts">
  import './animalForms.css';
  import Pill from '$lib/components/ui/Pill.svelte';
  import HoldVoidPanel from '$lib/components/records/HoldVoidPanel.svelte';
  import { errorText } from './labels';
  import type { HistoryEntry } from '$lib/animals/history';
  import { createT } from '$lib/i18n';
  import { page } from '$app/state';
  import { DEFAULT_PREFS, formatInstant, type Prefs } from '$lib/prefs';

  interface Props {
    entries: HistoryEntry[];
    prefs?: Prefs;
    onChanged: () => void | Promise<void>;
    /** After the owner voids a status change (32G G4). */
    onVoided?: () => void | Promise<void>;
  }

  const { entries, prefs = DEFAULT_PREFS, onChanged, onVoided }: Props = $props();
  const tr = $derived(createT(page.data?.locale));

  let busy = $state<string | null>(null);
  let error = $state<string | null>(null);

  async function undo(entry: HistoryEntry) {
    if (!entry.undo) return;
    if (!confirm(tr('animals.history.confirmRemove', { text: entry.text }))) return;
    busy = entry.id;
    error = null;
    try {
      const res = await fetch(entry.undo, { method: 'DELETE' });
      if (!res.ok) {
        error = await errorText(res, tr);
        return;
      }
      await onChanged();
    } catch {
      error = tr('animals.offline');
    } finally {
      busy = null;
    }
  }
</script>

{#if entries.length === 0}
  <p class="af-help">{tr('animals.history.empty')}</p>
{:else}
  <ol class="history" aria-label={tr('animals.history')}>
    {#each entries as e (e.id)}
      <li>
        <div class="line">
          <span class="when mono">{formatInstant(e.at, prefs, 'date')}</span>
          <span class="what">{e.text}</span>
          {#if e.locked}<Pill tone="neutral">{tr('animals.locked')}</Pill>{/if}
          {#if e.inHold}<span lang="en" data-english-only="safety"
              ><Pill tone="rust">Inside a hold</Pill></span
            >{/if}
          {#if e.late}<Pill tone="wheat">{e.late}</Pill>{/if}
        </div>
        {#if e.detail}<p class="detail">{e.detail}</p>{/if}
        {#if e.undo}
          <button
            type="button"
            class="af-ghost undo"
            disabled={busy !== null}
            onclick={() => undo(e)}
          >
            {busy === e.id ? tr('animals.removing') : tr('animals.undo')}
          </button>
        {/if}
        {#if e.voidUrl}
          <HoldVoidPanel
            url={e.voidUrl}
            canVoidHolds
            voidableUntilMs={e.voidableUntilMs ?? null}
            timeZone={prefs.timeZone}
            onVoided={() => (onVoided ?? onChanged)()}
          />
        {/if}
      </li>
    {/each}
  </ol>
  {#if error}<p class="af-error" role="alert">{error}</p>{/if}
{/if}

<style>
  .history {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
  }
  li {
    padding: var(--space-2) 0;
    border-bottom: 1px solid var(--color-divider-soft);
  }
  li:last-child {
    border-bottom: none;
  }
  .line {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2);
  }
  .when {
    font-size: var(--font-size-caption);
    color: var(--color-ink-muted);
  }
  .what {
    font-weight: 600;
    min-width: 0;
    overflow-wrap: anywhere;
  }
  .detail {
    margin: 2px 0 0;
    color: var(--color-ink-soft);
    overflow-wrap: anywhere;
  }
  .undo {
    margin-top: var(--space-2);
  }
</style>

<script lang="ts">
  import './animalForms.css';
  import Pill from '$lib/components/ui/Pill.svelte';
  import HoldVoidPanel from '$lib/components/records/HoldVoidPanel.svelte';
  import { OFFLINE_MESSAGE, errorFromResponse } from '$lib/animals/display';
  import type { HistoryEntry } from '$lib/animals/history';
  import { DEFAULT_PREFS, formatInstant, type Prefs } from '$lib/prefs';

  interface Props {
    entries: HistoryEntry[];
    prefs?: Prefs;
    onChanged: () => void | Promise<void>;
    /** After the owner voids a status change (32G G4). */
    onVoided?: () => void | Promise<void>;
  }

  const { entries, prefs = DEFAULT_PREFS, onChanged, onVoided }: Props = $props();

  let busy = $state<string | null>(null);
  let error = $state<string | null>(null);

  async function undo(entry: HistoryEntry) {
    if (!entry.undo) return;
    if (!confirm(`Remove "${entry.text}"?`)) return;
    busy = entry.id;
    error = null;
    try {
      const res = await fetch(entry.undo, { method: 'DELETE' });
      if (!res.ok) {
        error = await errorFromResponse(res);
        return;
      }
      await onChanged();
    } catch {
      error = OFFLINE_MESSAGE;
    } finally {
      busy = null;
    }
  }
</script>

{#if entries.length === 0}
  <p class="af-help">Nothing recorded yet.</p>
{:else}
  <ol class="history" aria-label="History">
    {#each entries as e (e.id)}
      <li>
        <div class="line">
          <span class="when mono">{formatInstant(e.at, prefs, 'date')}</span>
          <span class="what">{e.text}</span>
          {#if e.locked}<Pill tone="neutral">Locked</Pill>{/if}
          {#if e.inHold}<Pill tone="rust">Inside a hold</Pill>{/if}
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
            {busy === e.id ? 'Removing…' : 'Undo'}
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

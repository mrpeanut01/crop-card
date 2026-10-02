<script lang="ts">
  import Modal from '$lib/components/ui/Modal.svelte';
  import Provenance from '$lib/components/ui/Provenance.svelte';
  import { formatCalendarDate } from '$lib/prefs';
  import type { CarryoverConfirmBody } from '$lib/amendments/spreadPrompt';

  interface Props {
    open: boolean;
    facts: CarryoverConfirmBody | null;
    busy?: boolean;
    onConfirm: (factsHash: string) => void;
    onClose: () => void;
  }
  const { open, facts, busy = false, onConfirm, onClose }: Props = $props();
</script>

<Modal {open} {onClose} title="Before you spread this" closeOnBackdrop={false}>
  {#if facts}
    <div class="carry-confirm" data-testid="carryover-confirm">
      <p class="state">
        {facts.batch.name}: {facts.stateLabel}
        <Provenance source="data" detail="your records" compact />
      </p>
      <p>{facts.message}</p>
      {#if facts.pathSentences.length}
        <ul>
          {#each facts.pathSentences as p, i (i)}<li>{p}</li>{/each}
        </ul>
        {#if facts.morePaths}<p class="meta">And {facts.morePaths} more.</p>{/if}
      {/if}
      {#each facts.standingNotes as n, i (i)}<p class="meta">{n}</p>{/each}
      <p class="sub">Why this block:</p>
      <ul>
        {#each facts.reasonTexts as r, i (i)}<li>{r}</li>{/each}
      </ul>
      {#if facts.bioassays.length}
        <p class="sub">Pea or bean tests of this batch on file:</p>
        <ul>
          {#each facts.bioassays as b (b.id)}
            <li>
              {formatCalendarDate(b.testedOn, 'date')}: {b.result === 'no-damage'
                ? 'no damage seen'
                : 'damage seen'}
            </li>
          {/each}
        </ul>
      {/if}
      <p class="meta">
        You can still save it. Your confirmation and these facts are kept with the record. A pea or
        bean test before planting is the usual check.
      </p>
    </div>
  {/if}
  {#snippet footer()}
    <div class="actions">
      <button type="button" class="ghost" onclick={onClose} disabled={busy}>Cancel</button>
      <button
        type="button"
        class="primary"
        disabled={busy || !facts}
        onclick={() => facts && onConfirm(facts.factsHash)}
      >
        {busy ? 'Saving…' : 'I understand, save it'}
      </button>
    </div>
  {/snippet}
</Modal>

<style>
  .carry-confirm {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    overflow-wrap: anywhere;
  }
  .carry-confirm p {
    margin: 0;
  }
  .state {
    font-weight: 700;
    color: var(--pill-rust-fg);
  }
  .sub {
    font-weight: 600;
  }
  .meta {
    font-size: var(--font-size-caption);
    color: var(--color-ink-soft);
  }
  ul {
    margin: 0;
    padding-left: 1.2em;
  }
  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
    justify-content: flex-end;
  }
  .actions button {
    min-height: 48px;
    padding: 0 18px;
    border-radius: var(--radius-input);
    font: inherit;
    font-weight: 600;
    cursor: pointer;
  }
  .primary {
    background: var(--color-forest, #1f5e3a);
    color: white;
    border: none;
  }
  .ghost {
    background: transparent;
    border: 1px solid var(--color-divider);
    color: var(--color-ink);
  }
</style>

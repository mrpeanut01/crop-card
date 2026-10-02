<script lang="ts">
  import Modal from '$lib/components/ui/Modal.svelte';
  import Provenance from '$lib/components/ui/Provenance.svelte';
  import { formatCalendarDate } from '$lib/prefs';
  import { page } from '$app/state';
  import { createT } from '$lib/i18n';
  import type { CarryoverConfirmBody } from '$lib/amendments/spreadPrompt';

  interface Props {
    open: boolean;
    facts: CarryoverConfirmBody | null;
    busy?: boolean;
    onConfirm: (factsHash: string) => void;
    onClose: () => void;
  }
  const { open, facts, busy = false, onConfirm, onClose }: Props = $props();
  const locale = $derived(page.data?.locale);
  const tr = $derived(createT(locale));
</script>

<Modal {open} {onClose} title={tr('carry.confirm.title')} closeOnBackdrop={false}>
  {#if facts}
    <div class="carry-confirm" data-testid="carryover-confirm">
      <p class="state">
        {facts.batch.name}: {facts.stateLabel}
        <Provenance source="data" detail={tr('amend.prov.yourRecords')} compact />
      </p>
      <p>{facts.message}</p>
      {#if facts.pathSentences.length}
        <ul>
          {#each facts.pathSentences as p, i (i)}<li>{p}</li>{/each}
        </ul>
        {#if facts.morePaths}<p class="meta">
            {tr('amend.morePaths', { count: facts.morePaths })}
          </p>{/if}
      {/if}
      {#each facts.standingNotes as n, i (i)}<p class="meta">{n}</p>{/each}
      <p class="sub">{tr('carry.confirm.why')}</p>
      <ul>
        {#each facts.reasonTexts as r, i (i)}<li>{r}</li>{/each}
      </ul>
      {#if facts.bioassays.length}
        <p class="sub">{tr('carry.confirm.tests')}</p>
        <ul>
          {#each facts.bioassays as b (b.id)}
            <li>
              {formatCalendarDate(b.testedOn, 'date', {}, locale)}: {b.result === 'no-damage'
                ? tr('carry.test.noDamageSeen')
                : tr('carry.test.damageSeen')}
            </li>
          {/each}
        </ul>
      {/if}
      <p class="meta">
        {tr('carry.confirm.foot')}
      </p>
    </div>
  {/if}
  {#snippet footer()}
    <div class="actions">
      <button type="button" class="ghost" onclick={onClose} disabled={busy}
        >{tr('carry.confirm.cancel')}</button
      >
      <button
        type="button"
        class="primary"
        disabled={busy || !facts}
        onclick={() => facts && onConfirm(facts.factsHash)}
      >
        {busy ? tr('carry.confirm.saving') : tr('carry.confirm.ok')}
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

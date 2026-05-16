<script lang="ts">
  /**
   * Compact summary chip for an existing SeasonSetup (Phase 21 / UC-42).
   *
   * Rendered in the Plan wizard when the operator has already completed
   * Season Setup for the active year, and on /today as a passive header
   * indicator. Owners see an Edit affordance; helpers see the chip read-only.
   */

  import type { SeasonSetup } from '$lib/season/setup';
  import { summarizeSeasonSetup } from '$lib/season/setup';

  let {
    setup,
    canEdit = true,
    onEdit
  }: {
    setup: SeasonSetup;
    canEdit?: boolean;
    onEdit?: () => void;
  } = $props();

  const summary = $derived(summarizeSeasonSetup(setup));
</script>

<div class="sc-chip">
  <span class="sc-prefix" aria-hidden="true">🌱</span>
  <span class="sc-summary">{summary}</span>
  {#if canEdit && onEdit}
    <button type="button" class="sc-edit" onclick={onEdit}>Edit</button>
  {/if}
</div>

<style>
  .sc-chip {
    display: inline-flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.4rem 0.75rem;
    background: #f0f7f2;
    border: 1px solid #c4d2c4;
    border-radius: 999px;
    font-size: 0.88rem;
    color: #1f5e3a;
    max-width: 100%;
  }
  .sc-prefix {
    flex-shrink: 0;
  }
  .sc-summary {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    min-width: 0;
  }
  .sc-edit {
    flex-shrink: 0;
    min-height: 32px;
    padding: 0.2rem 0.6rem;
    background: white;
    color: #1f5e3a;
    border: 1px solid #1f5e3a;
    border-radius: 6px;
    font-size: 0.85rem;
    font-weight: 600;
    cursor: pointer;
  }
  .sc-edit:hover {
    background: #1f5e3a;
    color: white;
  }
  .sc-edit:focus-visible {
    outline: 2px solid #1f5e3a;
    outline-offset: 2px;
  }
</style>

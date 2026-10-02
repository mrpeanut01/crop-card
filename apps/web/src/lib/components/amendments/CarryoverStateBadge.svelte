<script lang="ts">
  /** Phase 33C (M-42): a batch's carryover state, never "safe" or "clear". */
  import { stateChip, type CarryoverState } from '$lib/amendments/carryover';

  interface Props {
    state: CarryoverState;
  }

  const { state }: Props = $props();
</script>

<span class="badge {state}" data-testid="carryover-state" data-state={state}
  >{stateChip(state)}</span
>

<style>
  .badge {
    display: inline-flex;
    align-items: center;
    padding: 2px 10px;
    border-radius: 99px;
    font-size: 0.8rem;
    font-weight: 600;
    line-height: 1.6;
    white-space: normal;
  }
  .may-carry {
    background: var(--pill-rust-bg, #f4d9cf);
    color: var(--pill-rust-fg, #7a2e14);
  }
  .not-known {
    background: var(--pill-wheat-bg, #e8d9b5);
    color: var(--pill-wheat-fg, #6b4f12);
  }
  .none-on-file {
    background: var(--pill-neutral-bg, #ecebe6);
    color: var(--color-ink, #1c1c1c);
  }
</style>

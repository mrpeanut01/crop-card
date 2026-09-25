<script lang="ts" module>
  export interface PriorFungicide {
    pluginId: string;
    displayName: string;
    fracCodes: string[];
    occurredAt: number;
  }
</script>

<script lang="ts">
  import { fmt } from '$lib/prefsState.svelte';
  import GroupCodeBadge from '$lib/components/GroupCodeBadge.svelte';
  import Pill from '$lib/components/ui/Pill.svelte';
  import Provenance from '$lib/components/ui/Provenance.svelte';
  import type { SafetyViolation } from '$lib/safety/types';

  interface Props {
    /** Output of `checkFracRotation()` for the current tank mix + block. */
    violations: SafetyViolation[];
    prior: PriorFungicide | null;
    proposedFracCodes: string[];
    /** Same-FRAC pair inside this tank (advisory, not a kernel block). */
    tankOverlapCode?: string | null;
  }

  const { violations, prior, proposedFracCodes, tankOverlapCode = null }: Props = $props();

  const blocked = $derived(violations.length > 0);
  const warn = $derived(!blocked && !!tankOverlapCode);
  const status = $derived<'pass' | 'warn' | 'block' | 'idle'>(
    proposedFracCodes.length === 0 ? 'idle' : blocked ? 'block' : warn ? 'warn' : 'pass'
  );
  const sharedCodes = $derived(
    Array.from(
      new Set(
        violations.flatMap((v) => {
          const codes = v.detail?.sharedFracCodes;
          return Array.isArray(codes) ? codes.map(String) : [];
        })
      )
    )
  );
</script>

<div class="tile {status}" data-testid="frac-rotation-tile" data-state={status}>
  <div class="head">
    <span class="title">FRAC rotation</span>
    {#if status === 'block'}
      <Pill tone="rust">Same group as last spray</Pill>
    {:else if status === 'warn'}
      <Pill tone="wheat">Group repeated in tank</Pill>
    {:else if status === 'pass'}
      <Pill tone="forest">Group cleared</Pill>
    {:else}
      <Pill tone="neutral">Pick a product</Pill>
    {/if}
    <span class="enforced">Kernel-enforced</span>
  </div>

  <div class="groups">
    <span class="lbl">Last</span>
    {#if prior}
      {#each prior.fracCodes as code (code)}<GroupCodeBadge kind="FRAC" group={code} />{/each}
    {:else}
      <span class="muted">none on record</span>
    {/if}
    <span class="arrow" aria-hidden="true">→</span>
    <span class="lbl">Next</span>
    {#each proposedFracCodes as code (code)}<GroupCodeBadge kind="FRAC" group={code} />{/each}
    {#if proposedFracCodes.length === 0}<span class="muted">—</span>{/if}
  </div>

  <p class="msg" role={status === 'block' ? 'alert' : undefined}>
    {#if status === 'block'}
      FRAC {sharedCodes.join(', ')} was used in the most recent fungicide on this block ({prior?.displayName ??
        'prior application'}, {prior ? fmt.instant(prior.occurredAt, 'date') : ''}). Rotate to a
      different mode of action — the server will refuse this record.
    {:else if status === 'warn'}
      FRAC {tankOverlapCode} is on two products in this tank. Consider a different mode of action for
      resistance management.
    {:else if status === 'pass' && prior}
      No FRAC group overlaps the last fungicide on this block ({prior.displayName}, {fmt.instant(
        prior.occurredAt,
        'date'
      )}).
    {:else if status === 'pass'}
      No prior fungicide recorded on this block — nothing to rotate against.
    {:else}
      Select a product to check rotation against this block's spray history.
    {/if}
    <Provenance source="plugin" detail="FRAC codes from plugin label" compact />
    {#if prior}<Provenance source="data" detail="your fungicide records" compact />{/if}
  </p>
</div>

<style>
  .tile {
    border: 1px solid var(--pill-neutral-bd);
    background: var(--color-paper, #fff);
    border-radius: 6px;
    padding: 12px 14px;
  }
  .tile.pass {
    background: #eff6e9;
    border-color: var(--pill-forest-bd);
  }
  .tile.warn {
    background: #fbf1dc;
    border-color: var(--pill-wheat-bd);
    border-left: 4px solid var(--color-wheat);
  }
  .tile.block {
    background: #fbe4d2;
    border-color: var(--pill-rust-bd);
    border-left: 4px solid var(--color-rust);
  }
  .head {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 8px;
    margin-bottom: 8px;
  }
  .title {
    font-family: var(--font-serif, serif);
    font-size: 1.05rem;
    color: var(--color-forest-deep);
  }
  .enforced {
    margin-left: auto;
    font-size: 0.72rem;
    color: var(--color-ink-soft);
    text-transform: uppercase;
    letter-spacing: 0.06em;
  }
  .groups {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 6px;
    margin-bottom: 8px;
    font-size: 0.85rem;
  }
  .lbl {
    font-weight: 700;
    color: var(--color-ink-soft);
    text-transform: uppercase;
    font-size: 0.72rem;
    letter-spacing: 0.06em;
  }
  .arrow {
    color: var(--color-ink-soft);
    padding: 0 4px;
  }
  .muted {
    color: var(--color-ink-soft);
  }
  .msg {
    margin: 0;
    font-size: 0.9rem;
    color: var(--color-ink);
    line-height: 1.45;
  }
</style>

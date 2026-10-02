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
  import { page } from '$app/state';
  import { createT } from '$lib/i18n';
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

  const tr = $derived(createT(page.data?.locale));
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
    <span class="title">{tr('sprayui.frac.title')}</span>
    {#if status === 'block'}
      <span lang="en" data-english-only="safety"
        ><Pill tone="rust">Same group as last spray</Pill></span
      >
    {:else if status === 'warn'}
      <span lang="en" data-english-only="safety"
        ><Pill tone="wheat">Group repeated in tank</Pill></span
      >
    {:else if status === 'pass'}
      <span lang="en" data-english-only="safety"><Pill tone="forest">Group cleared</Pill></span>
    {:else}
      <Pill tone="neutral">{tr('sprayui.frac.pick')}</Pill>
    {/if}
    <span class="enforced">{tr('sprayui.frac.enforced')}</span>
  </div>

  <div class="groups">
    <span class="lbl">{tr('sprayui.frac.last')}</span>
    {#if prior}
      {#each prior.fracCodes as code (code)}<GroupCodeBadge kind="FRAC" group={code} />{/each}
    {:else}
      <span class="muted">{tr('sprayui.frac.none')}</span>
    {/if}
    <span class="arrow" aria-hidden="true">→</span>
    <span class="lbl">{tr('sprayui.frac.next')}</span>
    {#each proposedFracCodes as code (code)}<GroupCodeBadge kind="FRAC" group={code} />{/each}
    {#if proposedFracCodes.length === 0}<span class="muted">—</span>{/if}
  </div>

  <p class="msg" role={status === 'block' ? 'alert' : undefined}>
    {#if status === 'block'}
      <span lang="en" data-english-only="safety">
        FRAC {sharedCodes.join(', ')} was used in the most recent fungicide on this block ({prior?.displayName ??
          'prior application'}, {prior ? fmt.instant(prior.occurredAt, 'date') : ''}). Rotate to a
        different mode of action — the server will refuse this record.
      </span>
    {:else if status === 'warn'}
      <span lang="en" data-english-only="safety">
        FRAC {tankOverlapCode} is on two products in this tank. Consider a different mode of action for
        resistance management.
      </span>
    {:else if status === 'pass' && prior}
      <span lang="en" data-english-only="safety">
        No FRAC group overlaps the last fungicide on this block ({prior.displayName}, {fmt.instant(
          prior.occurredAt,
          'date'
        )}).
      </span>
    {:else if status === 'pass'}
      <span lang="en" data-english-only="safety">
        No prior fungicide recorded on this block — nothing to rotate against.
      </span>
    {:else}
      {tr('sprayui.frac.idle')}
    {/if}
    <Provenance source="plugin" detail={tr('sprayui.frac.codesFromLabel')} compact />
    {#if prior}<Provenance source="data" detail={tr('sprayui.frac.yourRecords')} compact />{/if}
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

<script lang="ts">
  import { Lock } from 'lucide-svelte';
  import type { Snippet } from 'svelte';

  /**
   * Phase 27A primitive (#257). Read-only key/value pair for inventory
   * detail screens. The `tone` prop picks the value's style: `mono` for
   * codes (EPA reg, lot #), `tight` for the default plain line, `locked`
   * for kernel-locked fields rendered with the green-tint Lock badge so
   * the operator knows the value is plugin-bound and cannot be edited
   * from this surface.
   */
  interface Props {
    label: string;
    value?: string | number | null;
    tone?: 'tight' | 'mono' | 'locked';
    /** Optional custom value renderer (NPK chart, status pill, etc.).
     *  When provided, `value` is ignored. */
    children?: Snippet;
  }

  const { label, value, tone = 'tight', children }: Props = $props();
</script>

<div class="inv-kvp" class:locked={tone === 'locked'}>
  <span class="inv-kvp-label">
    {label}
    {#if tone === 'locked'}
      <Lock size={11} strokeWidth={2} aria-label="Kernel-locked" />
    {/if}
  </span>
  <span class="inv-kvp-value" class:mono={tone === 'mono' || tone === 'locked'}>
    {#if children}
      {@render children()}
    {:else}
      {value ?? '—'}
    {/if}
  </span>
</div>

<style>
  .inv-kvp {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .inv-kvp.locked {
    background: var(--color-forest-tint, #e8f1ea);
    border-left: 3px solid var(--color-forest, #1f5e3a);
    padding: 6px 8px;
    border-radius: 4px;
  }
  .inv-kvp-label {
    font-size: var(--font-size-kicker, 0.7rem);
    font-weight: 600;
    color: var(--color-ink-muted, #6a6f63);
    letter-spacing: 0.08em;
    text-transform: uppercase;
    display: inline-flex;
    align-items: center;
    gap: 4px;
  }
  .inv-kvp-value {
    font-size: 0.95rem;
    color: var(--color-ink, #1c1c1c);
  }
  .inv-kvp-value.mono {
    font-family: var(--font-mono, ui-monospace, SFMono-Regular, Menlo, monospace);
    font-size: 0.85rem;
  }
</style>
